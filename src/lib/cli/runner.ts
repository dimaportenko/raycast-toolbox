import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export type CliMode = "codex" | "claude" | "gemini" | "ollama";

export interface CliPreferences {
  cliMode: CliMode;
  cliPath: string;
  model: string;
  timeoutSeconds: string;
}

export interface RunCliOptions {
  prefs: CliPreferences;
  prompt: string;
  logTag: string;
}

// codex reads stdin if it isn't EOF even when given a positional prompt, and
// execFile's `input` option is silently ignored in the async variant. Spawn
// directly and close stdin ourselves.
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
        const e = new Error(
          `Timed out after ${timeoutMs}ms`,
        ) as NodeJS.ErrnoException & { stderr?: string };
        e.code = "ETIMEDOUT";
        e.stderr = stderr;
        return reject(e);
      }
      if (code !== 0) {
        const e = new Error(
          `Exit code ${code}${signal ? ` (signal ${signal})` : ""}`,
        ) as NodeJS.ErrnoException & {
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

function defaultCliBinary(mode: CliMode): string {
  if (mode === "codex") return "codex";
  if (mode === "gemini") return "gemini";
  if (mode === "ollama") return "/opt/homebrew/bin/ollama";
  return "claude";
}

function resolveCliPath(prefs: CliPreferences): string {
  const path = prefs.cliPath?.trim();
  if (!path) return defaultCliBinary(prefs.cliMode);

  // Older installs have /opt/homebrew/bin/codex stored as the global default.
  // If the user changes only AI CLI, prefer that mode's binary instead of
  // accidentally invoking Codex with Ollama/Claude/Gemini arguments.
  if (prefs.cliMode !== "codex" && path === "/opt/homebrew/bin/codex") {
    return defaultCliBinary(prefs.cliMode);
  }

  return path;
}

function buildClaudeArgs(prefs: CliPreferences, prompt: string): string[] {
  const args = ["-p", prompt, "--output-format", "json"];
  const model = prefs.model?.trim();
  if (model) args.push("--model", model);
  return args;
}

function buildCodexArgs(
  prefs: CliPreferences,
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

function buildGeminiArgs(prefs: CliPreferences, prompt: string): string[] {
  const args = ["--skip-trust", "-p", prompt, "-o", "text"];
  const model = prefs.model?.trim();
  if (model) args.push("-m", model);
  return args;
}

function resolveModel(prefs: CliPreferences): string {
  const model = prefs.model?.trim();
  if (prefs.cliMode === "ollama" && (!model || model === "gpt-5.4-mini")) {
    return "qwen2.5:3b-instruct";
  }
  return model ?? "";
}

function ollamaBaseUrl(): string {
  const host = process.env.OLLAMA_HOST?.trim() || "http://127.0.0.1:11434";
  const withProtocol = /^https?:\/\//i.test(host) ? host : `http://${host}`;
  return withProtocol.replace(/\/$/, "");
}

async function runOllamaApi(
  model: string,
  prompt: string,
  timeoutMs: number,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${ollamaBaseUrl()}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, prompt, format: "json", stream: false }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }
    const data = (await response.json()) as {
      response?: unknown;
      error?: unknown;
    };
    if (typeof data.error === "string" && data.error) {
      throw new Error(data.error);
    }
    if (typeof data.response !== "string") {
      throw new Error("Ollama response did not include a string response");
    }
    return data.response;
  } finally {
    clearTimeout(timer);
  }
}

function unwrapClaudeEnvelope(raw: string): string {
  try {
    const env = JSON.parse(raw);
    if (env && typeof env.result === "string") return env.result;
  } catch {
    // not an envelope, return raw
  }
  return raw;
}

export function extractJsonObject(raw: string): string {
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

export function wrapCliError(err: unknown, cli: string): Error {
  const e = err as NodeJS.ErrnoException & { stderr?: string };
  if (e.code === "ENOENT") {
    return new Error(`CLI not found: ${cli}. Check the CLI Path preference.`);
  }
  const stderrTail = (e.stderr ?? "").split("\n").slice(-5).join("\n").trim();
  return new Error(
    `CLI failed (${e.code ?? "unknown"})${stderrTail ? `\n${stderrTail}` : ""}`,
  );
}

export async function runCli(opts: RunCliOptions): Promise<string> {
  const { prefs, prompt, logTag } = opts;
  const cli = resolveCliPath(prefs);
  const timeoutMs = Math.max(5, Number(prefs.timeoutSeconds) || 30) * 1000;

  console.log(`${logTag} cli start`, {
    mode: prefs.cliMode,
    cli,
    model: resolveModel(prefs) || "(default)",
    timeoutMs,
    promptLen: prompt.length,
  });

  if (prefs.cliMode === "codex") {
    const tmpDir = await mkdtemp(join(tmpdir(), "raycast-cli-"));
    const outFile = join(tmpDir, "last.txt");
    try {
      const args = buildCodexArgs(prefs, prompt, outFile);
      console.log(`${logTag} spawn codex`, { cli, argv: args.slice(0, -1) });
      try {
        const { stdout, stderr } = await runWithClosedStdin(
          cli,
          args,
          timeoutMs,
        );
        if (stdout)
          console.log(`${logTag} codex stdout tail:`, stdout.slice(-200));
        if (stderr)
          console.log(`${logTag} codex stderr tail:`, stderr.slice(-400));
      } catch (err) {
        console.error(`${logTag} codex exec failed`, err);
        throw wrapCliError(err, cli);
      }
      const out = await readFile(outFile, "utf8");
      console.log(`${logTag} codex --output-last-message:`, out);
      return out;
    } finally {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  if (prefs.cliMode === "gemini") {
    const args = buildGeminiArgs(prefs, prompt);
    console.log(`${logTag} spawn gemini`, {
      cli,
      argv: ["--skip-trust", "-p", "<prompt>", "-o", "text"],
    });
    try {
      const { stdout, stderr } = await runWithClosedStdin(cli, args, timeoutMs);
      if (stderr)
        console.log(`${logTag} gemini stderr tail:`, stderr.slice(-400));
      console.log(`${logTag} gemini stdout:`, stdout);
      return stdout;
    } catch (err) {
      console.error(`${logTag} gemini exec failed`, err);
      throw wrapCliError(err, cli);
    }
  }

  if (prefs.cliMode === "ollama") {
    const model = resolveModel(prefs);
    console.log(`${logTag} call ollama api`, {
      baseUrl: ollamaBaseUrl(),
      model,
    });
    try {
      const output = await runOllamaApi(model, prompt, timeoutMs);
      console.log(`${logTag} ollama output:`, output);
      return output;
    } catch (err) {
      console.error(`${logTag} ollama api failed`, err);
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Ollama failed: ${message}. Make sure Ollama is running and the model is pulled.`,
      );
    }
  }

  const args = buildClaudeArgs(prefs, prompt);
  console.log(`${logTag} spawn claude`, {
    cli,
    argv: ["-p", "<prompt>", "--output-format", "json"],
  });
  let stdout: string;
  try {
    const result = await execFileP(cli, args, {
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
    });
    stdout = result.stdout;
    if (result.stderr)
      console.log(`${logTag} claude stderr tail:`, result.stderr.slice(-400));
  } catch (err) {
    console.error(`${logTag} claude exec failed`, err);
    throw wrapCliError(err, cli);
  }
  const unwrapped = unwrapClaudeEnvelope(stdout);
  console.log(`${logTag} claude model output:`, unwrapped);
  return unwrapped;
}
