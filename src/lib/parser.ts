import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ParsedReminder, Preferences } from "../types";

const execFileP = promisify(execFile);

// Run a CLI with stdin explicitly closed and collect stdout/stderr.
// Needed for codex: it reads stdin if it isn't EOF, even when given a
// positional prompt, and the async `execFile`'s `input` option is silently
// ignored (it only works in the *Sync variants).
function runWithClosedStdin(
  cli: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cli, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (killed) {
        const e = new Error(`Timed out after ${timeoutMs}ms`) as NodeJS.ErrnoException & { stderr?: string };
        e.code = "ETIMEDOUT";
        e.stderr = stderr;
        return reject(e);
      }
      if (code !== 0) {
        const e = new Error(`Exit code ${code}${signal ? ` (signal ${signal})` : ""}`) as NodeJS.ErrnoException & {
          stderr?: string;
        };
        e.code = String(code ?? signal ?? "unknown");
        e.stderr = stderr;
        return reject(e);
      }
      resolve({ stdout, stderr });
    });
    child.stdin.end();
  });
}

const SCHEMA_DESCRIPTION = `{
  "title":       string,                         // imperative; the reminder body, no date words
  "dueDate":     string | null,                  // ISO 8601 with timezone offset, e.g. "2026-05-21T16:00:00-07:00"
  "list":        string | null,                  // Reminders list name if user named one, else null
  "notes":       string | null,                  // any extra info the user gave
  "priority":    "low" | "medium" | "high" | null,
  "recurrence":  string | null                   // RFC 5545 RRULE if user said "every X", else null
}`;

function buildPrompt(userText: string): string {
  const now = new Date();
  const iso = now.toISOString();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const weekday = now.toLocaleDateString(undefined, { weekday: "long" });
  return [
    "You parse natural-language reminder requests into JSON.",
    `Current date/time: ${iso} (${weekday}). User timezone: ${tz}.`,
    "Return ONLY a single JSON object. No prose, no code fences, no commentary.",
    "Schema:",
    SCHEMA_DESCRIPTION,
    "Rules:",
    '- "today", "tonight", "tomorrow", "next Monday" etc. resolve relative to the current date/time above.',
    '- If the user gives a time without AM/PM, prefer the next future occurrence (e.g. "at 9" after 9am means 9pm).',
    "- Strip date/time words from `title`. Title is what to do, not when.",
    "- If recurrence is mentioned, emit an RFC 5545 RRULE (e.g. FREQ=WEEKLY;BYDAY=MO).",
    "- If a field is not present in the input, return null (do not invent values).",
    "",
    `User input: ${JSON.stringify(userText)}`,
  ].join("\n");
}

function resolveCliPath(prefs: Preferences): string {
  if (prefs.cliPath && prefs.cliPath.trim()) return prefs.cliPath.trim();
  return prefs.cliMode === "codex" ? "codex" : "claude";
}

function buildClaudeArgs(prefs: Preferences, prompt: string): string[] {
  const args = ["-p", prompt, "--output-format", "json"];
  const model = prefs.model?.trim();
  if (model) args.push("--model", model);
  return args;
}

function buildCodexArgs(
  prefs: Preferences,
  prompt: string,
  outputFile: string,
): string[] {
  const args = [
    "exec",
    "--skip-git-repo-check",
    "--output-last-message",
    outputFile,
  ];
  const model = prefs.model?.trim();
  if (model) args.push("--model", model);
  args.push(prompt);
  return args;
}

function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenceMatch ? fenceMatch[1] : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in CLI output");
  }
  return candidate.slice(start, end + 1);
}

function unwrapClaudeEnvelope(raw: string): string {
  try {
    const env = JSON.parse(raw);
    if (env && typeof env.result === "string") return env.result;
  } catch {
    // fall through to raw
  }
  return raw;
}

function normalize(obj: unknown): ParsedReminder {
  if (!obj || typeof obj !== "object") {
    throw new Error("Parsed result is not an object");
  }
  const o = obj as Record<string, unknown>;
  const title = typeof o.title === "string" ? o.title.trim() : "";
  if (!title) throw new Error("Parsed result is missing a title");

  const allowedPriority = new Set(["low", "medium", "high"]);
  const priorityRaw =
    typeof o.priority === "string" ? o.priority.toLowerCase() : null;
  const priority =
    priorityRaw && allowedPriority.has(priorityRaw)
      ? (priorityRaw as ParsedReminder["priority"])
      : null;

  return {
    title,
    dueDate: typeof o.dueDate === "string" && o.dueDate ? o.dueDate : null,
    list: typeof o.list === "string" && o.list ? o.list : null,
    notes: typeof o.notes === "string" && o.notes ? o.notes : null,
    priority,
    recurrence:
      typeof o.recurrence === "string" && o.recurrence ? o.recurrence : null,
  };
}

export async function parseReminder(
  text: string,
  prefs: Preferences,
): Promise<ParsedReminder> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Reminder text is empty");
  if (trimmed.length > 4000)
    throw new Error("Reminder text is too long (max 4000 chars)");

  const cli = resolveCliPath(prefs);
  const prompt = buildPrompt(trimmed);
  const timeoutMs = Math.max(5, Number(prefs.timeoutSeconds) || 30) * 1000;

  console.log("[ai-reminder] parser start", {
    mode: prefs.cliMode,
    cli,
    model: prefs.model || "(default)",
    timeoutMs,
    inputLen: trimmed.length,
  });

  let modelOutput: string;
  let tmpDir: string | null = null;

  try {
    if (prefs.cliMode === "codex") {
      tmpDir = await mkdtemp(join(tmpdir(), "ai-reminder-"));
      const outFile = join(tmpDir, "last.txt");
      const args = buildCodexArgs(prefs, prompt, outFile);
      console.log("[ai-reminder] spawn codex", { cli, argv: args.slice(0, -1) });
      try {
        const { stdout, stderr } = await runWithClosedStdin(cli, args, timeoutMs);
        console.log("[ai-reminder] codex stdout tail:", stdout.slice(-200));
        if (stderr) console.log("[ai-reminder] codex stderr tail:", stderr.slice(-400));
      } catch (err) {
        console.error("[ai-reminder] codex exec failed", err);
        throw wrapCliError(err, cli);
      }
      modelOutput = await readFile(outFile, "utf8");
      console.log("[ai-reminder] codex --output-last-message:", modelOutput);
    } else {
      const args = buildClaudeArgs(prefs, prompt);
      console.log("[ai-reminder] spawn claude", { cli, argv: ["-p", "<prompt>", "--output-format", "json"] });
      let stdout: string;
      try {
        const result = await execFileP(cli, args, {
          timeout: timeoutMs,
          maxBuffer: 4 * 1024 * 1024,
        });
        stdout = result.stdout;
        if (result.stderr) console.log("[ai-reminder] claude stderr tail:", result.stderr.slice(-400));
      } catch (err) {
        console.error("[ai-reminder] claude exec failed", err);
        throw wrapCliError(err, cli);
      }
      modelOutput = unwrapClaudeEnvelope(stdout);
      console.log("[ai-reminder] claude model output:", modelOutput);
    }
  } finally {
    if (tmpDir)
      await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }

  let jsonText: string;
  try {
    jsonText = extractJsonObject(modelOutput);
  } catch (err) {
    console.error("[ai-reminder] extractJsonObject failed", err, "raw:", modelOutput);
    throw new Error(
      `Model did not return JSON.\nRaw output (first 400 chars):\n${modelOutput.slice(0, 400)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error(`CLI returned invalid JSON:\n${jsonText.slice(0, 300)}`);
  }
  return normalize(parsed);
}

function wrapCliError(err: unknown, cli: string): Error {
  const e = err as NodeJS.ErrnoException & { stderr?: string };
  if (e.code === "ENOENT") {
    return new Error(`CLI not found: ${cli}. Check the CLI Path preference.`);
  }
  const stderrTail = (e.stderr ?? "").split("\n").slice(-5).join("\n").trim();
  return new Error(
    `CLI failed (${e.code ?? "unknown"})${stderrTail ? `\n${stderrTail}` : ""}`,
  );
}
