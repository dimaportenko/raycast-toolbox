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
    '- Treat bare times like "17:00" as dueDate today at that time, or tomorrow if that time already passed.',
    "- Strip date/time words from `title`. Title is what to do, not when.",
    "- Recurrence defaults to null/no repeat. If recurrence is mentioned, emit an RFC 5545 RRULE (e.g. FREQ=WEEKLY;BYDAY=MO).",
    '- For "every weekday", use recurrence "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR".',
    "- If recurrence is mentioned with a due time/date, dueDate is the first upcoming occurrence that matches the recurrence.",
    "- If a field is not present in the input, return null (do not invent values).",
    "",
    `User input: ${JSON.stringify(userText)}`,
  ].join("\n");
}

export function inferRecurrence(text: string): string | null {
  const lower = text.toLowerCase();
  if (/\b(no repeat|non[-\s]?recurring|one[-\s]?time)\b/.test(lower)) {
    return null;
  }
  if (/\b(?:every|each)\s+weekdays?\b|\bweekdays?\b/.test(lower)) {
    return "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";
  }
  if (/\b(?:every|each)\s+day\b|\bdaily\b/.test(lower)) {
    return "FREQ=DAILY";
  }
  if (/\b(?:every|each)\s+week\b|\bweekly\b/.test(lower)) {
    return "FREQ=WEEKLY";
  }
  if (/\b(?:every|each)\s+month\b|\bmonthly\b/.test(lower)) {
    return "FREQ=MONTHLY";
  }
  if (/\b(?:every|each)\s+year\b|\byearly\b|\bannually\b/.test(lower)) {
    return "FREQ=YEARLY";
  }
  return null;
}

function cleanupTitle(title: string): string {
  return title
    .replace(/\b(?:every|each)\s+weekdays?\b/gi, "")
    .replace(/\b(?:every|each)\s+day\b|\bdaily\b/gi, "")
    .replace(/\b(?:every|each)\s+week\b|\bweekly\b/gi, "")
    .replace(/\b(?:every|each)\s+month\b|\bmonthly\b/gi, "")
    .replace(/\b(?:every|each)\s+year\b|\byearly\b|\bannually\b/gi, "")
    .replace(/\b(?:at\s*)?(?:[01]?\d|2[0-3]):[0-5]\d\b/gi, "")
    .replace(/\b(?:at\s*)?\d{1,2}(?::[0-5]\d)?\s*(?:am|pm)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/[-–—,.;:\s]+$/g, "")
    .trim();
}

function inferTime(text: string): { hours: number; minutes: number } | null {
  if (/\bmorning\b/i.test(text)) return { hours: 9, minutes: 0 };
  if (/\bafternoon\b/i.test(text)) return { hours: 13, minutes: 0 };
  if (/\b(?:evening|tonight)\b/i.test(text)) return { hours: 18, minutes: 0 };

  const amPm = /\b(?:at\s*)?(\d{1,2})(?::([0-5]\d))?\s*(am|pm)\b/i.exec(text);
  if (amPm) {
    let hours = Number(amPm[1]);
    const minutes = amPm[2] ? Number(amPm[2]) : 0;
    const meridiem = amPm[3].toLowerCase();
    if (hours < 1 || hours > 12) return null;
    if (meridiem === "pm" && hours !== 12) hours += 12;
    if (meridiem === "am" && hours === 12) hours = 0;
    return { hours, minutes };
  }

  const twentyFourHour = /\b(?:at\s*)?([01]?\d|2[0-3]):([0-5]\d)\b/i.exec(text);
  if (twentyFourHour) {
    return {
      hours: Number(twentyFourHour[1]),
      minutes: Number(twentyFourHour[2]),
    };
  }

  const bareHour = /\bat\s+(\d{1,2})\b/i.exec(text);
  if (bareHour) {
    const hours = Number(bareHour[1]);
    if (hours >= 0 && hours <= 23) return { hours, minutes: 0 };
  }

  return null;
}

const RRULE_DAY_TO_DATE_DAY: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

function recurrenceDays(recurrence: string | null): number[] | null {
  const byDay = /(?:^|;)BYDAY=([^;]+)/i.exec(recurrence ?? "")?.[1];
  if (!byDay) return null;
  const days = byDay
    .split(",")
    .map((day) => RRULE_DAY_TO_DATE_DAY[day.slice(-2).toUpperCase()])
    .filter((day): day is number => typeof day === "number");
  return days.length ? days : null;
}

function inferDueDate(text: string, recurrence: string | null): string | null {
  const time = inferTime(text);
  if (!time) return null;

  const now = new Date();
  const candidate = new Date(now);
  candidate.setHours(time.hours, time.minutes, 0, 0);

  if (/\btomorrow\b/i.test(text)) {
    candidate.setDate(candidate.getDate() + 1);
  }

  const days = recurrenceDays(recurrence);
  if (days) {
    for (let offset = 0; offset < 14; offset += 1) {
      const next = new Date(candidate);
      next.setDate(candidate.getDate() + offset);
      if (days.includes(next.getDay()) && next.getTime() > now.getTime()) {
        return next.toISOString();
      }
    }
  }

  if (candidate.getTime() <= now.getTime()) {
    candidate.setDate(candidate.getDate() + 1);
  }
  return candidate.toISOString();
}

function normalizeDueDate(
  raw: unknown,
  userText: string,
  recurrence: string | null,
): string | null {
  if (typeof raw === "string" && raw) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return raw;
  }
  return inferDueDate(userText, recurrence);
}

function normalize(obj: unknown, userText: string): ParsedReminder {
  if (!obj || typeof obj !== "object") {
    throw new Error("Parsed result is not an object");
  }
  const o = obj as Record<string, unknown>;
  let title = typeof o.title === "string" ? o.title.trim() : "";
  if (!title) throw new Error("Parsed result is missing a title");
  title = cleanupTitle(title) || title;

  const allowedPriority = new Set(["low", "medium", "high"]);
  const priorityRaw =
    typeof o.priority === "string" ? o.priority.toLowerCase() : null;
  const priority =
    priorityRaw && allowedPriority.has(priorityRaw)
      ? (priorityRaw as ParsedReminder["priority"])
      : null;

  const recurrence =
    typeof o.recurrence === "string" && o.recurrence
      ? o.recurrence
      : inferRecurrence(userText);

  return {
    title,
    dueDate: normalizeDueDate(o.dueDate, userText, recurrence),
    list: typeof o.list === "string" && o.list ? o.list : null,
    notes: typeof o.notes === "string" && o.notes ? o.notes : null,
    priority,
    recurrence,
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
  return normalize(parsed, trimmed);
}
