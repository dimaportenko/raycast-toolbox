import {
  Toast,
  closeMainWindow,
  getPreferenceValues,
  showHUD,
  showToast,
} from "@raycast/api";
import { clearProfileStatus } from "./lib/slack/client";
import { SlackApiError } from "./lib/slack/types";
import type { Preferences } from "./lib/reminders/types";

export default async function Command() {
  const prefs = getPreferenceValues<Preferences>();
  if (!prefs.slackToken?.trim()) {
    await showToast({
      style: Toast.Style.Failure,
      title: "No Slack token",
      message: "Add a Slack User OAuth Token in extension preferences.",
    });
    return;
  }
  try {
    await clearProfileStatus(prefs.slackToken);
    await closeMainWindow();
    await showHUD("✓ Slack status cleared");
  } catch (err) {
    const message =
      err instanceof SlackApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    console.error("[slack-status] clear failed", err);
    await showToast({
      style: Toast.Style.Failure,
      title: "Clear failed",
      message: message.slice(0, 300),
    });
  }
}
