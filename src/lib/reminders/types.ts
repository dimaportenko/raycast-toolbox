import type { CliPreferences } from "../cli/runner";

export type Priority = "low" | "medium" | "high";

export interface ParsedReminder {
  title: string;
  dueDate: string | null;
  list: string | null;
  notes: string | null;
  priority: Priority | null;
  recurrence: string | null;
}

export interface Preferences extends CliPreferences {
  defaultList: string;
  slackToken: string;
}
