# Toolbox

Personal Raycast extension — a growing collection of commands I use day to day. Each command lives next to the others in this single extension so they share preferences and dependencies.

## Commands

| Command | What it does |
| --- | --- |
| **Create ReMYnder** (`parse-reminder`) | Type a reminder in natural language. A headless AI CLI (Claude Code, OpenAI Codex, or Google Gemini) parses title / due date / list / priority / RRULE, you confirm in a preview form, and it lands in Apple Reminders via `osascript`. |
| **Set Slack Status** (`set-slack-status`) | Type a status in natural language (`in a meeting until 3pm`). AI parses text + emoji + expiration; you confirm and it ships to Slack via `users.profile.set`. ⌘1–⌘5 re-applies a recent status without re-parsing. See [docs/slack-setup.md](docs/slack-setup.md) for token setup. |
| **Clear Slack Status** (`clear-slack-status`) | No-view command — clears your Slack profile status immediately. Bind to a Raycast hotkey. |

## Requirements

- macOS with Raycast.
- For `parse-reminder`:
  - Reminders access granted to Raycast.
  - One of [Claude Code CLI](https://docs.claude.com/claude-code) (`claude`), [OpenAI Codex CLI](https://developers.openai.com/codex) (`codex`), or [Google Gemini CLI](https://geminicli.com/) (`gemini`).
- For `set-slack-status` / `clear-slack-status`:
  - A Slack User OAuth Token with the `users.profile:write` scope. Follow [docs/slack-setup.md](docs/slack-setup.md).

## Install

Requires [pnpm](https://pnpm.io/installation) (`packageManager` is pinned in `package.json`).

```bash
cd raycast-toolbox
pnpm install
pnpm dev        # opens Raycast in dev mode with this extension loaded
```

For a release build:

```bash
pnpm build
```

## Layout

```
src/
  parse-reminder.tsx        # command entry (Raycast manifest)
  set-slack-status.tsx
  clear-slack-status.tsx
  lib/
    cli/
      runner.ts             # shared CLI spawn / arg builders / JSON extract
    reminders/              # everything reminder-specific
      parser.ts
      reminders.ts
      types.ts
    slack/
      parser.ts             # AI prompt → ParsedStatus (text, emoji, expiration)
      client.ts             # users.profile.set / clear
      recent.ts             # LocalStorage recents for ⌘1–⌘5
      types.ts
```

Each new command gets its own `<command>.tsx` at the top of `src/` and (if non-trivial) a matching `src/lib/<feature>/` folder for its supporting code.

## Preferences (current)

| Setting | Default | Notes |
| --- | --- | --- |
| AI CLI | `codex` | `claude`, `codex`, or `gemini` — used by every command that parses natural language. |
| CLI Path | `/opt/homebrew/bin/codex` | Absolute path; Raycast doesn't inherit shell `PATH`. |
| Model | `gpt-5.4-mini` | Passed to the CLI. Empty = CLI default. |
| Default List | `Reminders` | Reminders list to use when the AI didn't name one. |
| Parse Timeout (seconds) | `30` | Max wait for the CLI to return. |
| Slack User OAuth Token | _(empty)_ | `xoxp-…` token with `users.profile:write`. See [docs/slack-setup.md](docs/slack-setup.md). |

## Notes on `parse-reminder`

- **Why AppleScript, not `launchCommand` to `raycast/apple-reminders`?** That extension's `create-reminder` command reads `draftValues` from `LaunchProps`, not `launchContext`, and the public `launchCommand` API only sets `context`. `osascript` gives deterministic, full-field control with no extra packaging.
- **Locale-safe dates.** AppleScript's `date "MM/DD/YYYY ..."` literal is parsed using the system locale, which silently mangles dates on non-US systems. We construct dates by assigning `year`/`month`/`day`/`hours`/`minutes`/`seconds` properties instead.
- **Envelope handling.** `claude --output-format json` wraps the model reply in `{ "result": "..." }`; `codex exec --json` emits NDJSON events. The parser unwraps both and tolerates code fences.

## Troubleshooting

- **"CLI not found"** — set CLI Path in preferences, or install the chosen CLI on `PATH`.
- **"List not found"** — the AI picked a list name that doesn't exist. Edit the list in the preview form before submitting.
- **Reminder appears with wrong date** — confirm your timezone is correct; the prompt includes the local timezone from `Intl.DateTimeFormat().resolvedOptions().timeZone`.
