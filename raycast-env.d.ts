/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** AI CLI - Which headless CLI to use for parsing. */
  "cliMode": "codex" | "claude",
  /** CLI Path - Absolute path to the CLI binary. Raycast does not inherit your shell PATH, so use the full path. */
  "cliPath": string,
  /** Model - Model name passed to the CLI (codex --model, claude --model). Leave empty to use the CLI default. */
  "model": string,
  /** Default List - Name of the Reminders list to use when none is parsed. */
  "defaultList": string,
  /** Parse Timeout (seconds) - Max wait for the CLI to return. */
  "timeoutSeconds": string
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `parse-reminder` command */
  export type ParseReminder = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `parse-reminder` command */
  export type ParseReminder = {}
}

