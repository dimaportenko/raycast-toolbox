import { extractJsonObject, runCli } from "../cli/runner";
import type { Preferences } from "../reminders/types";
import type { ParsedStatus } from "./types";

const STATUS_TEXT_MAX = 100;
const DEFAULT_DURATION_MS = 60 * 60 * 1000;
const MIN_DURATION_MS = 60 * 1000;

const SCHEMA_DESCRIPTION = `{
  "status_text":  string,            // what to display next to your name; may be empty
  "status_emoji": string | null,     // Slack emoji shortcode like ":calendar:" — pick one that fits
  "expiration":   string | null      // ISO 8601 with timezone, when status should auto-clear; null if not given
}`;

function buildStatusPrompt(userText: string): string {
  const now = new Date();
  const iso = now.toISOString();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const weekday = now.toLocaleDateString(undefined, { weekday: "long" });
  return [
    "You parse natural-language Slack status requests into JSON.",
    `Current date/time: ${iso} (${weekday}). User timezone: ${tz}.`,
    "Return ONLY a single JSON object. No prose, no code fences, no commentary.",
    "Schema:",
    SCHEMA_DESCRIPTION,
    "Rules:",
    "- Strip time/duration words from status_text. Keep it short (under 100 chars).",
    '- Pick a Slack emoji shortcode that visually fits (e.g. "in a meeting" → ":calendar:", "lunch" → ":sandwich:", "focus" → ":headphones:", "out sick" → ":face_with_thermometer:", "walk" → ":walking:", "coffee" → ":coffee:").',
    '- Always wrap the emoji name in colons (e.g. ":sparkles:") — no spaces, no leading/trailing whitespace.',
    '- Resolve "until 3pm", "for 1 hour", "for 45min" etc. relative to the current date/time above.',
    "- If the user gives a time without AM/PM, prefer the next future occurrence.",
    "- If no expiration is mentioned, return expiration=null (the app picks a default).",
    "",
    `User input: ${JSON.stringify(userText)}`,
  ].join("\n");
}

function normalizeEmoji(raw: unknown): { emoji: string; adjusted: boolean } {
  if (typeof raw !== "string") return { emoji: "", adjusted: false };
  const trimmed = raw.trim();
  if (!trimmed) return { emoji: "", adjusted: false };
  // Already a valid shortcode.
  if (/^:[a-z0-9_+-]+:$/i.test(trimmed))
    return { emoji: trimmed.toLowerCase(), adjusted: false };
  // Try to recover from a bare name like "calendar" or "calendar:".
  const inner = trimmed.replace(/^:+|:+$/g, "");
  if (/^[a-z0-9_+-]+$/i.test(inner)) {
    return { emoji: `:${inner.toLowerCase()}:`, adjusted: true };
  }
  return { emoji: "", adjusted: true };
}

function normalize(obj: unknown, now: Date): ParsedStatus {
  if (!obj || typeof obj !== "object") {
    throw new Error("Parsed result is not an object");
  }
  const o = obj as Record<string, unknown>;
  const adjustments: string[] = [];

  let text = typeof o.status_text === "string" ? o.status_text.trim() : "";
  if (text.length > STATUS_TEXT_MAX) {
    text = text.slice(0, STATUS_TEXT_MAX);
    adjustments.push(`truncated text to ${STATUS_TEXT_MAX} chars`);
  }

  const emojiNorm = normalizeEmoji(o.status_emoji);
  const emoji = emojiNorm.emoji;
  if (emojiNorm.adjusted) {
    if (emoji) adjustments.push(`wrapped emoji in colons (${emoji})`);
    else adjustments.push("dropped invalid emoji");
  }

  let expirationMs: number;
  const rawExp = o.expiration;
  if (typeof rawExp === "string" && rawExp.trim()) {
    const parsed = new Date(rawExp).getTime();
    if (Number.isNaN(parsed)) {
      expirationMs = now.getTime() + DEFAULT_DURATION_MS;
      adjustments.push("unparseable expiration → default 1h");
    } else if (parsed - now.getTime() < MIN_DURATION_MS) {
      expirationMs = now.getTime() + DEFAULT_DURATION_MS;
      adjustments.push("expiration was in the past → default 1h");
    } else {
      expirationMs = parsed;
    }
  } else {
    expirationMs = now.getTime() + DEFAULT_DURATION_MS;
    adjustments.push("no expiration given → default 1h");
  }

  if (!text && !emoji) {
    throw new Error("Parsed result has neither status text nor emoji");
  }

  return {
    statusText: text,
    statusEmoji: emoji,
    expiration: Math.floor(expirationMs / 1000),
    durationMs: expirationMs - now.getTime(),
    adjustments,
  };
}

export async function parseStatus(
  text: string,
  prefs: Preferences,
): Promise<ParsedStatus> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Status text is empty");
  if (trimmed.length > 2000)
    throw new Error("Status text is too long (max 2000 chars)");

  const modelOutput = await runCli({
    prefs,
    prompt: buildStatusPrompt(trimmed),
    logTag: "[slack-status]",
  });

  let jsonText: string;
  try {
    jsonText = extractJsonObject(modelOutput);
  } catch (err) {
    console.error(
      "[slack-status] extractJsonObject failed",
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
  return normalize(parsed, new Date());
}
