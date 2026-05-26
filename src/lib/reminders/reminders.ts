import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ParsedReminder } from "./types";

const execFileP = promisify(execFile);

function priorityToInt(p: ParsedReminder["priority"]): number | null {
  if (!p) return null;
  if (p === "high") return 1;
  if (p === "medium") return 5;
  if (p === "low") return 9;
  return null;
}

type Frequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

interface RecurrenceDay {
  day: number;
  weekNumber: number | null;
}

interface RecurrenceSpec {
  frequency: Frequency;
  interval: number;
  byDay: RecurrenceDay[];
  byMonthDay: number[];
  byMonth: number[];
  byWeekNo: number[];
  byYearDay: number[];
  bySetPos: number[];
  end: { type: "count"; count: number } | { type: "until"; iso: string } | null;
}

const DAY_TO_EVENTKIT: Record<string, number> = {
  SU: 1,
  MO: 2,
  TU: 3,
  WE: 4,
  TH: 5,
  FR: 6,
  SA: 7,
};

function parseIntegerList(value: string, field: string): number[] {
  return value.split(",").map((part) => {
    const parsed = Number(part.trim());
    if (!Number.isInteger(parsed)) {
      throw new Error(`Unsupported recurrence ${field} value: ${part}`);
    }
    return parsed;
  });
}

function parseUntil(value: string): string {
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    return new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      23,
      59,
      59,
    ).toISOString();
  }

  const dateTime = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(
    value,
  );
  if (!dateTime)
    throw new Error(`Unsupported recurrence UNTIL value: ${value}`);
  const [, year, month, day, hour, minute, second, zulu] = dateTime;
  const args = [
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  ] as const;
  return zulu
    ? new Date(Date.UTC(...args)).toISOString()
    : new Date(...args).toISOString();
}

function parseRecurrenceRule(rrule: string | null): RecurrenceSpec | null {
  const trimmed = rrule?.trim();
  if (!trimmed) return null;

  const withoutPrefix = trimmed.toUpperCase().startsWith("RRULE:")
    ? trimmed.slice("RRULE:".length)
    : trimmed;
  const fields = new Map<string, string>();
  for (const token of withoutPrefix.split(";")) {
    const [key, ...rest] = token.split("=");
    if (!key || rest.length === 0) {
      throw new Error(`Unsupported recurrence token: ${token}`);
    }
    fields.set(key.trim().toUpperCase(), rest.join("=").trim().toUpperCase());
  }

  const frequency = fields.get("FREQ") as Frequency | undefined;
  if (
    !frequency ||
    !["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(frequency)
  ) {
    throw new Error(
      `Unsupported recurrence frequency: ${fields.get("FREQ") ?? "(missing)"}`,
    );
  }

  const intervalRaw = fields.get("INTERVAL");
  const interval = intervalRaw ? Number(intervalRaw) : 1;
  if (!Number.isInteger(interval) || interval < 1) {
    throw new Error(`Unsupported recurrence interval: ${intervalRaw}`);
  }

  const byDay = (fields.get("BYDAY") ?? "")
    .split(",")
    .filter(Boolean)
    .map((value): RecurrenceDay => {
      const match = /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(value);
      if (!match)
        throw new Error(`Unsupported recurrence BYDAY value: ${value}`);
      return {
        day: DAY_TO_EVENTKIT[match[2]],
        weekNumber: match[1] ? Number(match[1]) : null,
      };
    });

  let end: RecurrenceSpec["end"] = null;
  if (fields.has("COUNT")) {
    const count = Number(fields.get("COUNT"));
    if (!Number.isInteger(count) || count < 1) {
      throw new Error(
        `Unsupported recurrence COUNT value: ${fields.get("COUNT")}`,
      );
    }
    end = { type: "count", count };
  } else if (fields.has("UNTIL")) {
    end = { type: "until", iso: parseUntil(fields.get("UNTIL") ?? "") };
  }

  return {
    frequency,
    interval,
    byDay,
    byMonthDay: fields.has("BYMONTHDAY")
      ? parseIntegerList(fields.get("BYMONTHDAY") ?? "", "BYMONTHDAY")
      : [],
    byMonth: fields.has("BYMONTH")
      ? parseIntegerList(fields.get("BYMONTH") ?? "", "BYMONTH")
      : [],
    byWeekNo: fields.has("BYWEEKNO")
      ? parseIntegerList(fields.get("BYWEEKNO") ?? "", "BYWEEKNO")
      : [],
    byYearDay: fields.has("BYYEARDAY")
      ? parseIntegerList(fields.get("BYYEARDAY") ?? "", "BYYEARDAY")
      : [],
    bySetPos: fields.has("BYSETPOS")
      ? parseIntegerList(fields.get("BYSETPOS") ?? "", "BYSETPOS")
      : [],
    end,
  };
}

interface CreateArgs {
  title: string;
  dueDate: string | null;
  list: string;
  notes: string | null;
  priority: ParsedReminder["priority"];
  recurrence: ParsedReminder["recurrence"];
}

function buildCreateReminderScript(
  args: CreateArgs,
  recurrence: RecurrenceSpec | null,
): string {
  return `ObjC.import("EventKit");

const args = ${JSON.stringify({ ...args, priority: priorityToInt(args.priority) })};
const recurrence = ${JSON.stringify(recurrence)};

function fail(message) {
  throw new Error(message);
}

function ensureReminderAccess(store) {
  const status = $.EKEventStore.authorizationStatusForEntityType($.EKEntityTypeReminder);
  if (status === $.EKAuthorizationStatusAuthorized) return;
  if (status === $.EKAuthorizationStatusNotDetermined) {
    let done = false;
    let granted = false;
    let authError = null;
    store.requestAccessToEntityTypeCompletion($.EKEntityTypeReminder, (ok, error) => {
      granted = ok;
      authError = error;
      done = true;
    });
    while (!done) {
      $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.1));
    }
    if (granted) return;
    fail(authError ? ObjC.unwrap(authError.localizedDescription) : "Reminders access was not granted");
  }
  fail("Reminders access denied. Enable it in System Settings → Privacy & Security → Reminders.");
}

function absoluteDate(iso) {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) fail("Invalid due date: " + iso);
  return $.NSDate.dateWithTimeIntervalSince1970(ms / 1000);
}

function dateComponents(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) fail("Invalid due date: " + iso);
  const comps = $.NSDateComponents.alloc.init;
  comps.year = d.getFullYear();
  comps.month = d.getMonth() + 1;
  comps.day = d.getDate();
  comps.hour = d.getHours();
  comps.minute = d.getMinutes();
  comps.second = d.getSeconds();
  comps.timeZone = $.NSTimeZone.localTimeZone;
  return comps;
}

function numberArray(values) {
  if (!values || values.length === 0) return $();
  const array = $.NSMutableArray.array;
  values.forEach((value) => array.addObject($(value)));
  return array;
}

function recurrenceDayArray(values) {
  if (!values || values.length === 0) return $();
  const array = $.NSMutableArray.array;
  values.forEach((value) => {
    if (value.weekNumber === null || value.weekNumber === undefined) {
      array.addObject($.EKRecurrenceDayOfWeek.dayOfWeek(value.day));
    } else {
      array.addObject($.EKRecurrenceDayOfWeek.dayOfWeekWeekNumber(value.day, value.weekNumber));
    }
  });
  return array;
}

function recurrenceEnd(value) {
  if (!value) return $();
  if (value.type === "count") return $.EKRecurrenceEnd.recurrenceEndWithOccurrenceCount(value.count);
  if (value.type === "until") return $.EKRecurrenceEnd.recurrenceEndWithEndDate(absoluteDate(value.iso));
  return $();
}

function recurrenceFrequency(value) {
  if (value === "DAILY") return $.EKRecurrenceFrequencyDaily;
  if (value === "WEEKLY") return $.EKRecurrenceFrequencyWeekly;
  if (value === "MONTHLY") return $.EKRecurrenceFrequencyMonthly;
  if (value === "YEARLY") return $.EKRecurrenceFrequencyYearly;
  fail("Unsupported recurrence frequency: " + value);
}

function recurrenceRule(value) {
  if (!value) return null;
  return $.EKRecurrenceRule.alloc.initRecurrenceWithFrequencyIntervalDaysOfTheWeekDaysOfTheMonthMonthsOfTheYearWeeksOfTheYearDaysOfTheYearSetPositionsEnd(
    recurrenceFrequency(value.frequency),
    value.interval,
    recurrenceDayArray(value.byDay),
    numberArray(value.byMonthDay),
    numberArray(value.byMonth),
    numberArray(value.byWeekNo),
    numberArray(value.byYearDay),
    numberArray(value.bySetPos),
    recurrenceEnd(value.end),
  );
}

const store = $.EKEventStore.alloc.init;
ensureReminderAccess(store);

const calendars = store.calendarsForEntityType($.EKEntityTypeReminder);
let calendar = null;
for (let i = 0; i < calendars.count; i++) {
  const candidate = calendars.objectAtIndex(i);
  if (ObjC.unwrap(candidate.title) === args.list) {
    calendar = candidate;
    break;
  }
}
if (!calendar) fail("List not found: " + args.list);

const reminder = $.EKReminder.reminderWithEventStore(store);
reminder.title = args.title;
reminder.calendar = calendar;
if (args.notes) reminder.notes = args.notes;
if (args.priority !== null) reminder.priority = args.priority;
if (args.dueDate) {
  reminder.dueDateComponents = dateComponents(args.dueDate);
  reminder.addAlarm($.EKAlarm.alarmWithAbsoluteDate(absoluteDate(args.dueDate)));
}
const rule = recurrenceRule(recurrence);
if (rule) reminder.addRecurrenceRule(rule);

const error = $();
if (!store.saveReminderCommitError(reminder, true, error)) {
  fail("Failed to save reminder");
}
`;
}

export async function createReminder(args: CreateArgs): Promise<void> {
  const recurrence = parseRecurrenceRule(args.recurrence);
  const script = buildCreateReminderScript(args, recurrence);

  try {
    await execFileP("osascript", ["-l", "JavaScript", "-e", script], {
      timeout: 15_000,
    });
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    const stderrTail = (e.stderr ?? "").split("\n").slice(-3).join("\n").trim();
    throw new Error(
      `Failed to create reminder${stderrTail ? `: ${stderrTail}` : ""}`,
    );
  }
}

export async function listReminderLists(): Promise<string[]> {
  const script = `tell application "Reminders" to get name of every list`;
  try {
    const { stdout } = await execFileP("osascript", ["-e", script], {
      timeout: 5_000,
    });
    return stdout
      .trim()
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}
