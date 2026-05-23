export interface ParsedStatus {
  statusText: string;
  statusEmoji: string;
  expiration: number;
  durationMs: number;
  adjustments: string[];
}

export interface RecentStatus {
  text: string;
  emoji: string;
  durationMs: number;
  savedAt: number;
}

export interface SlackErrorInfo {
  code: string;
  message: string;
  retryAfterSec?: number;
}

export class SlackApiError extends Error {
  readonly code: string;
  readonly retryAfterSec?: number;
  constructor(info: SlackErrorInfo) {
    super(info.message);
    this.name = "SlackApiError";
    this.code = info.code;
    this.retryAfterSec = info.retryAfterSec;
  }
}
