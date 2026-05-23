# Slack setup

The `Set Slack Status` and `Clear Slack Status` commands talk to Slack directly with a **User OAuth Token** (`xoxp-…`). One token = one workspace.

## 1. Create a Slack app

1. Open https://api.slack.com/apps and click **Create New App** → **From scratch**.
2. Name it (e.g. `Raycast Toolbox`) and pick the workspace where you want to set your status.
3. Click **Create App**.

## 2. Add the required scope

1. In the left sidebar, open **OAuth & Permissions**.
2. Scroll to **Scopes** → **User Token Scopes** (not Bot Token Scopes).
3. Click **Add an OAuth Scope** and add: `users.profile:write`.

That single scope is enough for setting and clearing your profile status.

## 3. Install the app to your workspace

1. Still on the OAuth & Permissions page, scroll up to **OAuth Tokens for Your Workspace**.
2. Click **Install to Workspace** (or **Reinstall** if you previously installed it).
3. Approve the permissions prompt.
4. Copy the **User OAuth Token** — it starts with `xoxp-`.

## 4. Paste the token into Raycast

1. Open Raycast → search for any Toolbox command → press `⌘,` to open extension preferences.
2. Paste the `xoxp-…` token into the **Slack User OAuth Token** field.

That's it. Run `Set Slack Status`, type something like `in a meeting until 3pm`, and confirm in the preview.

## Troubleshooting

- **`Slack token is invalid`** — token field is empty or the value isn't a real `xoxp-` token. Recheck step 4.
- **`Missing users.profile:write scope`** — you added the scope under Bot Tokens instead of User Tokens, or you didn't reinstall the app after adding it. Reinstall (step 3) and copy the new token.
- **`This Slack token type can't set profile status`** — you copied a `xoxb-` (bot) token instead of a `xoxp-` (user) token. The User OAuth Token is in the same panel, one section above the bot token.
- **Status didn't appear in Slack** — Slack sometimes caches profile data for a minute. Refresh your own profile or check from another client.
