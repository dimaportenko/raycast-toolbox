import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ParsedReminder } from "../types";

const execFileP = promisify(execFile);

function escapeAS(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// Locale-independent AppleScript date construction. The `date "..."` literal
// is parsed using the user's system locale (e.g. DD/MM/YYYY in many regions),
// so building the date by property assignment is the only reliable path.
function asDateExpr(iso: string, varName: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid dueDate: ${iso}`);
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const hours = d.getHours();
  const minutes = d.getMinutes();
  const seconds = d.getSeconds();
  return [
    `set ${varName} to (current date)`,
    `set day of ${varName} to 1`, // avoid month-overflow when current day > target month length
    `set year of ${varName} to ${year}`,
    `set month of ${varName} to ${month}`,
    `set day of ${varName} to ${day}`,
    `set hours of ${varName} to ${hours}`,
    `set minutes of ${varName} to ${minutes}`,
    `set seconds of ${varName} to ${seconds}`,
  ].join("\n  ");
}

function priorityToInt(p: ParsedReminder["priority"]): number | null {
  if (!p) return null;
  if (p === "high") return 1;
  if (p === "medium") return 5;
  if (p === "low") return 9;
  return null;
}

interface CreateArgs {
  title: string;
  dueDate: string | null;
  list: string;
  notes: string | null;
  priority: ParsedReminder["priority"];
}

export async function createReminder(args: CreateArgs): Promise<void> {
  const props: string[] = [`name:"${escapeAS(args.title)}"`];
  const preamble: string[] = [];
  if (args.dueDate) {
    preamble.push(asDateExpr(args.dueDate, "dueD"));
    props.push(`due date:dueD`);
    props.push(`remind me date:dueD`);
  }
  if (args.notes) {
    props.push(`body:"${escapeAS(args.notes)}"`);
  }
  const prio = priorityToInt(args.priority);
  if (prio !== null) {
    props.push(`priority:${prio}`);
  }

  const script = [
    ...preamble,
    `tell application "Reminders"`,
    `  if not (exists list "${escapeAS(args.list)}") then`,
    `    error "List not found: ${escapeAS(args.list)}"`,
    `  end if`,
    `  tell list "${escapeAS(args.list)}"`,
    `    make new reminder with properties {${props.join(", ")}}`,
    `  end tell`,
    `end tell`,
  ].join("\n");

  try {
    await execFileP("osascript", ["-e", script], { timeout: 15_000 });
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
