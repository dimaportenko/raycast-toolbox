# AI Reminder — Raycast Extension Plan

A Raycast extension that takes natural-language input ("remind me today at 16:00 to have a call with Vitalii"), parses it with a headless AI CLI (Claude Code or Codex), shows a preview form for confirmation, and creates the reminder in macOS Apple Reminders.

## Decisions (locked in)

| Choice | Selected |
| --- | --- |
| AI backend | Codex / Claude Code headless CLI (`claude -p` or `codex exec`) |
| Reminders API | Hand off to Raycast's official `raycast/apple-reminders` extension via `launchCommand` |
| UX flow | Parse → preview form → confirm |

## Phase 0 verdict — Path B (AppleScript) selected

After reading `raycast/apple-reminders` source:

- `create-reminder` reads `draftValues` from `LaunchProps`, **not** `launchContext`. `launchCommand` cannot set `draftValues`, only `context`. Path A is not feasible for this command.
- `quick-add-reminder` accepts `arguments: { text, notes }` but runs its own AI parser on `text`, defeating the purpose of our parsing.
- **Path B (AppleScript via `osascript`) selected.** Full control over all fields (name, body, due date, list, priority).

## Architecture

```
┌────────────────────────────────────────────────┐
│ Your extension: ai-reminder                    │
│                                                │
│  Form (TextArea) ──► parse() ──► Preview Form  │
│                       │                ↓       │
│                       ↓        launchCommand   │
│              spawn `claude -p`         ↓       │
│                   (or codex)    raycast/apple- │
│              JSON-schema output     reminders  │
└────────────────────────────────────────────────┘
```

## Phase 0 — Verify the handoff contract (~30 min)

Before writing parser code, confirm what `raycast/apple-reminders` actually accepts.

- Clone `https://github.com/raycast/extensions`, open `extensions/apple-reminders/`.
- Read `package.json` for the exact `name:` of the create command.
- Grep the command's `.tsx` for `launchContext` / `useLaunchContext` / `props.launchContext` — that tells you which fields it pre-fills.
- If it pre-fills title/dueDate/list/notes → keep the handoff plan (Path A in Phase 4).
- If it does not → fall back to AppleScript via `osascript` (Path B in Phase 4). Decide here, before coding.

## Phase 1 — Scaffold (~15 min)

```bash
cd raycast-toolbox
npx create-raycast-extension@latest .
# Template: "Form" command, TypeScript, name: ai-reminder
```

Set up:

- `package.json` → one command `parse-reminder` (`mode: "view"`)
- Preferences:
  - `cliPath` — default `claude`
  - `cliMode` — `claude` | `codex`
  - `model` — optional override
  - `defaultList` — default Reminders list name
- Files:
  - `src/parse-reminder.tsx` — main UI
  - `src/lib/parser.ts` — CLI spawner
  - `src/lib/reminders.ts` — handoff

## Phase 2 — NL input + preview form (~1 hr)

Two-stage UI in one component, controlled by a `stage` state.

```tsx
stage === "input" → (
  <Form>
    <Form.TextArea id="text" autoFocus
      placeholder="remind me today at 16:00 to call Vitalii" />
    <Action title="Parse" onAction={parse} />
  </Form>
)

stage === "preview" → (
  <Form>
    <Form.TextField id="title" value={parsed.title} />
    <Form.DatePicker id="dueDate" value={parsed.dueDate} />
    <Form.Dropdown id="list" />
    <Form.TextArea id="notes" />
    <Form.TagPicker id="alerts" />
    <Action.SubmitForm title="Create Reminder" onSubmit={create} />
    <Action title="Edit prompt" shortcut={{ modifiers: ["cmd"], key: "e" }}
      onAction={() => setStage("input")} />
  </Form>
)
```

Show a `<Toast style={Animated}>Parsing…</Toast>` during the CLI call.

## Phase 3 — Headless CLI parser (~1–2 hrs)

`src/lib/parser.ts` — single function `parseReminder(text, prefs) → ParsedReminder`.

```ts
type ParsedReminder = {
  title: string;
  dueDate: string | null;     // ISO 8601
  list: string | null;
  notes: string | null;
  priority: "low" | "medium" | "high" | null;
  recurrence: string | null;  // RFC 5545 RRULE or null
};
```

Spawn shape (verify each flag exists before relying on it):

```ts
const { stdout } = await execFile(prefs.cliPath, [
  "-p", buildPrompt(text),
  "--output-format", "json",
  // try --json-schema first; if claude rejects it, fall back to
  // schema-in-system-prompt + JSON.parse(stdout.result)
], { timeout: 30_000 });
```

Prompt shape:

```
You parse natural-language reminder requests. Today is {ISO date} ({timezone}).
Return ONLY a JSON object matching this schema: {...}
User input: "{text}"
```

For Codex mode: `codex exec --json --output-schema schema.json -` with prompt on stdin.

Handle errors visibly: `Toast.Style.Failure` with the stderr tail. Never silently fail.

## Phase 4 — Handoff to Apple Reminders (~30 min – 2 hrs)

**Path A — structured context works (Phase 0 confirmed):**

```ts
await launchCommand({
  ownerOrAuthorName: "raycast",
  extensionName: "apple-reminders",
  name: "create-reminder",
  type: LaunchType.UserInitiated,
  context: { title, dueDate, list, notes, priority, recurrence },
});
```

**Path B — fallback, AppleScript:**

```ts
const script = `
  tell application "Reminders"
    tell list "${escapeAS(list ?? "Reminders")}"
      make new reminder with properties { name: "${escapeAS(title)}",
        ${dueDate ? `due date: date "${formatASDate(dueDate)}",` : ""}
        ${notes ? `body: "${escapeAS(notes)}"` : ""} }
    end tell
  end tell`;
await execFile("osascript", ["-e", script]);
```

Always close with `showHUD("✓ Reminder created")` + `closeMainWindow()`.

## Phase 5 — Polish (~1 hr)

- Empty-input guard; max-length guard (don't pipe 10 kB into the CLI).
- Cache the last-used list in `LocalStorage` to populate the Dropdown default.
- Add a "Try again" action when parse fails — re-runs the CLI with a stricter prompt.
- README with screenshot.

## Verification before declaring done

- `"remind me today at 16:00 to have a call with Vitalii"` → today's date, 16:00, "have a call with Vitalii".
- `"tomorrow morning pick up dry cleaning"` → tomorrow ~09:00, list `Reminders`.
- `"every Monday at 9 standup"` → recurrence populated.
- Empty string → friendly error, no crash.
- CLI not installed → preferences pointer in the error toast.

## Total estimate

~4–6 hrs end-to-end, dominated by Phase 0 verification + Phase 3 prompt iteration.
