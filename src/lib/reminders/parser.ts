import { extractJsonObject, runCli } from "../cli/runner";
import type { ParsedReminder, Preferences } from "./types";

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

  const modelOutput = await runCli({
    prefs,
    prompt: buildPrompt(trimmed),
    logTag: "[ai-reminder]",
  });

  let jsonText: string;
  try {
    jsonText = extractJsonObject(modelOutput);
  } catch (err) {
    console.error(
      "[ai-reminder] extractJsonObject failed",
      err,
      "raw:",
      modelOutput,
    );
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
