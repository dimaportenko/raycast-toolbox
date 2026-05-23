import {
  Action,
  ActionPanel,
  Detail,
  Form,
  Icon,
  LocalStorage,
  Toast,
  closeMainWindow,
  getPreferenceValues,
  popToRoot,
  showHUD,
  showToast,
} from "@raycast/api";
import { useEffect, useState } from "react";
import { parseReminder } from "./lib/reminders/parser";
import { createReminder, listReminderLists } from "./lib/reminders/reminders";
import type { ParsedReminder, Preferences } from "./lib/reminders/types";

type Stage = "input" | "preview" | "error";

const LAST_LIST_KEY = "ai-reminder.lastList";
const LAST_TEXT_KEY = "ai-reminder.lastText";

function toDate(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export default function Command() {
  const prefs = getPreferenceValues<Preferences>();
  const [stage, setStage] = useState<Stage>("input");
  const [text, setText] = useState<string>("");
  const [parsed, setParsed] = useState<ParsedReminder | null>(null);
  const [lists, setLists] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>("");

  useEffect(() => {
    listReminderLists().then((found) => {
      const fallback = prefs.defaultList?.trim() || "Reminders";
      const all = found.length > 0 ? found : [fallback];
      setLists(Array.from(new Set([fallback, ...all])));
    });
    LocalStorage.getItem<string>(LAST_TEXT_KEY).then((v) => {
      if (v && typeof v === "string") setText(v);
    });
  }, []);

  async function handleParse(values: { text: string }) {
    const input = values.text?.trim();
    if (!input) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Type a reminder first",
      });
      return;
    }
    setText(input);
    setBusy(true);
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: "Parsing…",
    });
    try {
      const result = await parseReminder(input, prefs);
      setParsed(result);
      setStage("preview");
      toast.style = Toast.Style.Success;
      toast.title = "Parsed";
      await LocalStorage.setItem(LAST_TEXT_KEY, input);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[ai-reminder] parse failed:", message);
      toast.style = Toast.Style.Failure;
      toast.title = "Parse failed";
      toast.message = message.slice(0, 300);
      setErrorMsg(message);
      setStage("error");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate(values: {
    title: string;
    dueDate: Date | null;
    list: string;
    notes: string;
    priority: string;
  }) {
    if (!values.title?.trim()) {
      await showToast({ style: Toast.Style.Failure, title: "Title required" });
      return;
    }
    const list =
      values.list?.trim() || prefs.defaultList?.trim() || "Reminders";
    setBusy(true);
    try {
      await createReminder({
        title: values.title.trim(),
        dueDate: values.dueDate ? values.dueDate.toISOString() : null,
        list,
        notes: values.notes?.trim() ? values.notes.trim() : null,
        priority: (values.priority as ParsedReminder["priority"]) || null,
      });
      await LocalStorage.setItem(LAST_LIST_KEY, list);
      await LocalStorage.removeItem(LAST_TEXT_KEY);
      await showHUD(`✓ Reminder created in ${list}`);
      await popToRoot({ clearSearchBar: true });
      await closeMainWindow();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await showToast({
        style: Toast.Style.Failure,
        title: "Create failed",
        message: message.slice(0, 300),
      });
    } finally {
      setBusy(false);
    }
  }

  if (stage === "error") {
    const md = [
      "# Parse failed",
      "",
      `**Input:** \`${text}\``,
      `**CLI:** \`${prefs.cliPath || "(from PATH)"}\``,
      `**Mode:** \`${prefs.cliMode}\`  **Model:** \`${prefs.model || "(default)"}\``,
      "",
      "## Error",
      "```",
      errorMsg,
      "```",
      "",
      "Tip: full logs print to the `pnpm dev` terminal.",
    ].join("\n");
    return (
      <Detail
        markdown={md}
        actions={
          <ActionPanel>
            <Action
              title="Back to Input"
              icon={Icon.ArrowLeft}
              onAction={() => setStage("input")}
            />
            <Action
              title="Retry"
              icon={Icon.ArrowClockwise}
              shortcut={{ modifiers: ["cmd"], key: "r" }}
              onAction={() => handleParse({ text })}
            />
            <Action.CopyToClipboard
              title="Copy Error"
              content={errorMsg}
              shortcut={{ modifiers: ["cmd"], key: "c" }}
            />
          </ActionPanel>
        }
      />
    );
  }

  if (stage === "input") {
    return (
      <Form
        isLoading={busy}
        actions={
          <ActionPanel>
            <Action.SubmitForm
              title="Parse"
              icon={Icon.Wand}
              onSubmit={(values: { text: string }) => handleParse(values)}
            />
          </ActionPanel>
        }
      >
        <Form.TextArea
          id="text"
          title="Reminder"
          placeholder="remind me today at 16:00 to have a call with Vitalii"
          autoFocus
          value={text}
          onChange={setText}
        />
        <Form.Description
          text={`Parser: ${prefs.cliMode}. Default list: ${prefs.defaultList || "Reminders"}.`}
        />
      </Form>
    );
  }

  const p = parsed!;
  return (
    <Form
      isLoading={busy}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Create Reminder"
            icon={Icon.Checkmark}
            onSubmit={(values) =>
              handleCreate(values as Parameters<typeof handleCreate>[0])
            }
          />
          <Action
            title="Edit Prompt"
            icon={Icon.Pencil}
            shortcut={{ modifiers: ["cmd"], key: "e" }}
            onAction={() => setStage("input")}
          />
          <Action
            title="Re-parse"
            icon={Icon.ArrowClockwise}
            shortcut={{ modifiers: ["cmd"], key: "r" }}
            onAction={() => handleParse({ text })}
          />
        </ActionPanel>
      }
    >
      <Form.TextField id="title" title="Title" defaultValue={p.title} />
      <Form.DatePicker
        id="dueDate"
        title="Due"
        defaultValue={toDate(p.dueDate) ?? undefined}
      />
      <Form.Dropdown
        id="list"
        title="List"
        defaultValue={
          lists.includes(p.list ?? "") ? (p.list as string) : lists[0]
        }
      >
        {lists.map((name) => (
          <Form.Dropdown.Item key={name} value={name} title={name} />
        ))}
      </Form.Dropdown>
      <Form.Dropdown
        id="priority"
        title="Priority"
        defaultValue={p.priority ?? ""}
      >
        <Form.Dropdown.Item value="" title="None" />
        <Form.Dropdown.Item value="low" title="Low" />
        <Form.Dropdown.Item value="medium" title="Medium" />
        <Form.Dropdown.Item value="high" title="High" />
      </Form.Dropdown>
      <Form.TextArea id="notes" title="Notes" defaultValue={p.notes ?? ""} />
      {p.recurrence ? (
        <Form.Description title="Recurrence (RRULE)" text={p.recurrence} />
      ) : null}
      <Form.Description text={`Input: "${text}"`} />
    </Form>
  );
}
