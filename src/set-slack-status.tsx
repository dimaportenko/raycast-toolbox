import {
  Action,
  ActionPanel,
  Detail,
  Form,
  Icon,
  Keyboard,
  LocalStorage,
  Toast,
  closeMainWindow,
  getPreferenceValues,
  popToRoot,
  showHUD,
  showToast,
} from "@raycast/api";
import { useEffect, useState } from "react";
import { parseStatus } from "./lib/slack/parser";
import { setProfileStatus } from "./lib/slack/client";
import { describeDuration, loadRecents, saveRecent } from "./lib/slack/recent";
import { SlackApiError } from "./lib/slack/types";
import type { ParsedStatus, RecentStatus } from "./lib/slack/types";
import type { Preferences } from "./lib/reminders/types";

type Stage = "input" | "preview" | "error";

const LAST_TEXT_KEY = "slack-status.lastText";

const KNOWN_TOAST_ERRORS = new Set([
  "invalid_auth",
  "not_authed",
  "token_revoked",
  "token_expired",
  "missing_scope",
  "not_allowed_token_type",
  "ratelimited",
  "account_inactive",
]);

function expirationToDate(unixSec: number): Date {
  return new Date(unixSec * 1000);
}

function formatExpiration(date: Date): string {
  return date.toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

async function reportSlackError(
  err: unknown,
  setErrorMsg: (msg: string) => void,
  setStage: (s: Stage) => void,
) {
  if (err instanceof SlackApiError && KNOWN_TOAST_ERRORS.has(err.code)) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Slack rejected the request",
      message: err.message,
    });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error("[slack-status] unknown error", err);
  setErrorMsg(message);
  setStage("error");
}

export default function Command() {
  const prefs = getPreferenceValues<Preferences>();
  const [stage, setStage] = useState<Stage>("input");
  const [text, setText] = useState<string>("");
  const [parsed, setParsed] = useState<ParsedStatus | null>(null);
  const [recents, setRecents] = useState<RecentStatus[]>([]);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>("");

  useEffect(() => {
    LocalStorage.getItem<string>(LAST_TEXT_KEY).then((v) => {
      if (typeof v === "string" && v) setText(v);
    });
    loadRecents().then(setRecents);
  }, []);

  async function applyRecent(entry: RecentStatus) {
    if (!prefs.slackToken?.trim()) {
      await showToast({
        style: Toast.Style.Failure,
        title: "No Slack token",
        message: "Add a Slack User OAuth Token in extension preferences.",
      });
      return;
    }
    setBusy(true);
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: `Setting: ${entry.emoji} ${entry.text || "(no text)"}`,
    });
    try {
      const expiration = Math.floor((Date.now() + entry.durationMs) / 1000);
      await setProfileStatus(prefs.slackToken, {
        text: entry.text,
        emoji: entry.emoji,
        expiration,
      });
      await saveRecent({
        text: entry.text,
        emoji: entry.emoji,
        durationMs: entry.durationMs,
      });
      toast.hide();
      await showHUD(
        `✓ ${entry.emoji} ${entry.text || "Status set"} until ${formatExpiration(expirationToDate(expiration))}`,
      );
      await popToRoot({ clearSearchBar: true });
      await closeMainWindow();
    } catch (err) {
      toast.hide();
      await reportSlackError(err, setErrorMsg, setStage);
    } finally {
      setBusy(false);
    }
  }

  async function handleParse(values: { text: string }) {
    const input = values.text?.trim();
    if (!input) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Type a status first",
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
      const result = await parseStatus(input, prefs);
      setParsed(result);
      setStage("preview");
      toast.style = Toast.Style.Success;
      toast.title = "Parsed";
      await LocalStorage.setItem(LAST_TEXT_KEY, input);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[slack-status] parse failed:", message);
      toast.style = Toast.Style.Failure;
      toast.title = "Parse failed";
      toast.message = message.slice(0, 300);
      setErrorMsg(message);
      setStage("error");
    } finally {
      setBusy(false);
    }
  }

  async function handleSet(values: {
    text: string;
    emoji: string;
    expiration: Date | null;
  }) {
    if (!prefs.slackToken?.trim()) {
      await showToast({
        style: Toast.Style.Failure,
        title: "No Slack token",
        message: "Add a Slack User OAuth Token in extension preferences.",
      });
      return;
    }
    const cleanText = (values.text ?? "").trim().slice(0, 100);
    const cleanEmoji = (values.emoji ?? "").trim();
    if (!cleanText && !cleanEmoji) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Need text or emoji",
      });
      return;
    }
    const now = Date.now();
    const expirationDate = values.expiration ?? new Date(now + 60 * 60 * 1000);
    if (expirationDate.getTime() <= now) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Expiration must be in the future",
      });
      return;
    }
    const expirationSec = Math.floor(expirationDate.getTime() / 1000);
    const durationMs = expirationDate.getTime() - now;

    setBusy(true);
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: "Setting status…",
    });
    try {
      await setProfileStatus(prefs.slackToken, {
        text: cleanText,
        emoji: cleanEmoji,
        expiration: expirationSec,
      });
      await saveRecent({ text: cleanText, emoji: cleanEmoji, durationMs });
      await LocalStorage.removeItem(LAST_TEXT_KEY);
      toast.hide();
      await showHUD(
        `✓ ${cleanEmoji} ${cleanText || "Status set"} until ${formatExpiration(expirationDate)}`,
      );
      await popToRoot({ clearSearchBar: true });
      await closeMainWindow();
    } catch (err) {
      toast.hide();
      await reportSlackError(err, setErrorMsg, setStage);
    } finally {
      setBusy(false);
    }
  }

  if (stage === "error") {
    const md = [
      "# Set status failed",
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
    const quickPickKeys: Keyboard.KeyEquivalent[] = ["1", "2", "3", "4", "5"];
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
            {recents.length > 0 && (
              <ActionPanel.Section title="Recent statuses">
                {recents.map((entry, idx) => (
                  <Action
                    key={`${entry.emoji}-${entry.text}-${entry.savedAt}`}
                    title={`Apply: ${entry.emoji} ${entry.text || "(no text)"} (${describeDuration(entry.durationMs)})`}
                    icon={Icon.Bolt}
                    shortcut={
                      idx < quickPickKeys.length
                        ? { modifiers: ["cmd"], key: quickPickKeys[idx] }
                        : undefined
                    }
                    onAction={() => applyRecent(entry)}
                  />
                ))}
              </ActionPanel.Section>
            )}
          </ActionPanel>
        }
      >
        <Form.TextArea
          id="text"
          title="Status"
          placeholder="in a meeting until 3pm"
          autoFocus
          value={text}
          onChange={setText}
        />
        {recents.length > 0 && (
          <Form.Description
            title="Recent"
            text={recents
              .slice(0, 5)
              .map(
                (e, i) =>
                  `⌘${i + 1}  ${e.emoji} ${e.text || "(no text)"}  ·  ${describeDuration(e.durationMs)}`,
              )
              .join("\n")}
          />
        )}
        <Form.Description text={`Parser: ${prefs.cliMode}`} />
      </Form>
    );
  }

  const p = parsed!;
  const expirationDate = expirationToDate(p.expiration);
  return (
    <Form
      isLoading={busy}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Set Status"
            icon={Icon.Checkmark}
            onSubmit={(values) =>
              handleSet(values as Parameters<typeof handleSet>[0])
            }
          />
          <Action
            title="Edit Input"
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
      <Form.TextField
        id="text"
        title="Status Text"
        defaultValue={p.statusText}
      />
      <Form.TextField
        id="emoji"
        title="Emoji"
        defaultValue={p.statusEmoji}
        placeholder=":calendar:"
      />
      <Form.DatePicker
        id="expiration"
        title="Until"
        defaultValue={expirationDate}
      />
      {p.adjustments.length > 0 && (
        <Form.Description title="Adjusted" text={p.adjustments.join(", ")} />
      )}
      <Form.Description text={`Input: "${text}"`} />
    </Form>
  );
}
