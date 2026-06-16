import { sanitizeTimestamp } from "../utils/sanitize";

export const TIMESTAMP_BLOCK_RE =
  /^[^\S\r\n]*\[(?<time>(?:\d{1,2}:)?\d{1,2}:\d{2})\](?:[^\S\r\n]+(?<title>[^\n]+))?[^\S\r\n]*$/gm;

export function isValidTimestamp(timestamp: string): boolean {
  const parts = timestamp.split(":").map((part) => Number(part));
  if (parts.length !== 2 && parts.length !== 3) return false;
  if (parts.some((part) => !Number.isInteger(part) || part < 0)) return false;

  const minutes = parts.length === 2 ? parts[0] : parts[1];
  const seconds = parts.length === 2 ? parts[1] : parts[2];
  return seconds <= 59 && (parts.length === 2 || minutes <= 59);
}

export function normalizeTimestamp(timestamp: string): string {
  const parts = timestamp.split(":");
  if (parts.length === 2) {
    return `${parts[0].padStart(2, "0")}:${parts[1].padStart(2, "0")}`;
  }

  return `${parts[0]}:${parts[1].padStart(2, "0")}:${parts[2].padStart(2, "0")}`;
}

export function toSafeTimestamp(timestamp: string): string {
  return sanitizeTimestamp(normalizeTimestamp(timestamp));
}
