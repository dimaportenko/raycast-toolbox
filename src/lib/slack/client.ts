import { SlackApiError } from "./types";

const PROFILE_SET_URL = "https://slack.com/api/users.profile.set";

interface SlackProfilePayload {
  status_text: string;
  status_emoji: string;
  status_expiration: number;
}

interface SlackResponse {
  ok: boolean;
  error?: string;
  warning?: string;
  needed?: string;
}

const FRIENDLY_ERRORS: Record<string, string> = {
  invalid_auth:
    "Slack token is invalid. Check the Slack User OAuth Token preference.",
  not_authed:
    "No Slack token provided. Set the Slack User OAuth Token preference.",
  token_revoked:
    "Slack token has been revoked. Generate a new one and update the preference.",
  token_expired:
    "Slack token has expired. Generate a new one and update the preference.",
  missing_scope:
    "Slack token is missing the users.profile:write scope. Reinstall the app with that scope.",
  not_allowed_token_type:
    "This Slack token type can't set profile status. Use a User OAuth (xoxp-) token.",
  account_inactive: "Slack workspace account is inactive.",
  ratelimited: "Slack rate-limited the request. Try again shortly.",
};

function friendlyMessage(code: string, needed?: string): string {
  const base = FRIENDLY_ERRORS[code];
  if (base) return needed ? `${base} (needed: ${needed})` : base;
  return needed
    ? `Slack error: ${code} (needed: ${needed})`
    : `Slack error: ${code}`;
}

async function callSlack(
  token: string,
  profile: SlackProfilePayload,
): Promise<void> {
  if (!token || !token.trim()) {
    throw new SlackApiError({
      code: "not_authed",
      message: FRIENDLY_ERRORS.not_authed,
    });
  }

  let resp: Response;
  try {
    resp = await fetch(PROFILE_SET_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.trim()}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ profile }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new SlackApiError({
      code: "network_error",
      message: `Network error contacting Slack: ${message}`,
    });
  }

  if (resp.status === 429) {
    const retryAfter = Number(resp.headers.get("Retry-After")) || undefined;
    throw new SlackApiError({
      code: "ratelimited",
      message: friendlyMessage("ratelimited"),
      retryAfterSec: retryAfter,
    });
  }

  let body: SlackResponse;
  try {
    body = (await resp.json()) as SlackResponse;
  } catch {
    throw new SlackApiError({
      code: "bad_response",
      message: `Slack returned non-JSON response (HTTP ${resp.status}).`,
    });
  }

  if (!body.ok) {
    const code = body.error || "unknown_error";
    throw new SlackApiError({
      code,
      message: friendlyMessage(code, body.needed),
    });
  }
}

export async function setProfileStatus(
  token: string,
  args: { text: string; emoji: string; expiration: number },
): Promise<void> {
  await callSlack(token, {
    status_text: args.text,
    status_emoji: args.emoji,
    status_expiration: args.expiration,
  });
}

export async function clearProfileStatus(token: string): Promise<void> {
  await callSlack(token, {
    status_text: "",
    status_emoji: "",
    status_expiration: 0,
  });
}
