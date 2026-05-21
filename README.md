# AI Reminder

Raycast extension that turns natural-language input into a macOS Apple Reminder, using a headless AI CLI (Claude Code or OpenAI Codex) to parse the request.

> Type `remind me today at 16:00 to have a call with Vitalii` → AI extracts title + due date → preview form → ⏎ creates it in Reminders.

## Requirements

- macOS with the Reminders app and Reminders access granted to Raycast.
- One of:
  - [Claude Code CLI](https://docs.claude.com/claude-code) — `claude` on `PATH`.
  - [OpenAI Codex CLI](https://developers.openai.com/codex) — `codex` on `PATH`.

## Install

Requires [pnpm](https://pnpm.io/installation) (`packageManager` is pinned in `package.json`).

```bash
cd /Users/dmitriyportenko/work/home/raycast/reminder
pnpm install
pnpm dev        # opens Raycast in dev mode with this extension loaded
```

Then run **Create Reminder from Text** from Raycast.

For a release build:

```bash
pnpm build
```

## Preferences

| Setting | Default | Notes |
| --- | --- | --- |
| AI CLI | `claude` | Choose `claude` or `codex`. |
| CLI Path | *(empty)* | Absolute path override; otherwise resolved on `PATH`. |
| Default List | `Reminders` | Used when the AI didn't pick a list or the parsed list doesn't exist. |
| Parse Timeout (seconds) | `30` | Max wait for the CLI to return. |

## How it works

1. You type a sentence (e.g. *"every Monday at 9 standup"*).
2. The extension spawns the configured CLI in headless JSON mode with a prompt that includes the current date/time and timezone.
3. The CLI returns a JSON object with `title`, `dueDate` (ISO 8601), `list`, `notes`, `priority`, `recurrence` (RRULE).
4. You see a preview form pre-filled with those fields. Edit anything, press ⏎ to commit.
5. Reminder is created via `osascript` directly against the Reminders app — no extra dependencies, no Raycast-Pro requirement.

## Architecture notes

- **Why AppleScript, not `launchCommand` to `raycast/apple-reminders`?** That extension's `create-reminder` command reads `draftValues` from `LaunchProps`, not `launchContext`, and the public `launchCommand` API only sets `context`. `osascript` gives us deterministic, full-field control with no extra packaging.
- **Locale-safe dates.** AppleScript's `date "MM/DD/YYYY ..."` literal is parsed using the system locale, which silently mangles dates on non-US systems. We construct dates by assigning `year`/`month`/`day`/`hours`/`minutes`/`seconds` properties instead.
- **Envelope handling.** `claude --output-format json` wraps the model reply in `{ "result": "..." }`; `codex exec --json` emits NDJSON events. The parser unwraps both and tolerates code fences.

## Troubleshooting

- **"CLI not found"** — set CLI Path in preferences, or install the chosen CLI on `PATH`.
- **"List not found"** — the AI picked a list name that doesn't exist. Edit the list in the preview form before submitting.
- **Reminder appears with wrong date** — confirm your timezone is correct; the prompt includes the local timezone from `Intl.DateTimeFormat().resolvedOptions().timeZone`.
