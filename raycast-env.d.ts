/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** AI CLI - Which headless CLI to use for parsing. */
  "cliMode": "codex" | "claude" | "gemini" | "ollama",
  /** CLI Path - Absolute path to the CLI binary. Raycast does not inherit your shell PATH, so use the full path. */
  "cliPath": string,
  /** Model - Model name passed to the CLI. For Ollama, use qwen2.5:3b-instruct for speed or qwen2.5:7b-instruct for reliability. Leave empty to use the CLI default. */
  "model": string,
  /** Default List - Name of the Reminders list to use when none is parsed. */
  "defaultList": string,
  /** Parse Timeout (seconds) - Max wait for the CLI to return. */
  "timeoutSeconds": string,
  /** Slack User OAuth Token - xoxp- token from a Slack app with users.profile:write scope. See docs/slack-setup.md for step-by-step setup. */
  "slackToken"?: string
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `parse-reminder` command */
  export type ParseReminder = ExtensionPreferences & {}
  /** Preferences accessible in the `set-slack-status` command */
  export type SetSlackStatus = ExtensionPreferences & {}
  /** Preferences accessible in the `clear-slack-status` command */
  export type ClearSlackStatus = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `parse-reminder` command */
  export type ParseReminder = {}
  /** Arguments passed to the `set-slack-status` command */
  export type SetSlackStatus = {}
  /** Arguments passed to the `clear-slack-status` command */
  export type ClearSlackStatus = {}
}

