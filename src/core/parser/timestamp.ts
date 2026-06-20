import { sanitizeTimestamp } from "../utils/sanitize";

export const TIMESTAMP_BLOCK_RE =
  /^[^\S\r\n]*\[(?<time>[^\]]+)\](?:[^\S\r\n]+(?<title>[^\r\n]+))?[^\S\r\n]*$/gm;

export function isValidTimestamp(timestamp: string): boolean {
  return /\d/.test(timestamp) && /[:\->]/.test(timestamp);
}

export function normalizeTimestamp(timestamp: string): string {
  const parts = timestamp.split(/->|-/);
  const normalizedParts = parts.map((part) => {
    const cleaned = part.trim().replace(/\s+/g, "");
    const timeParts = cleaned.split(":");
    if (timeParts.length === 2) {
      return `${timeParts[0].padStart(2, "0")}:${timeParts[1].padStart(2, "0")}`;
    }
    if (timeParts.length === 3) {
      return `${timeParts[0]}:${timeParts[1].padStart(2, "0")}:${timeParts[2].padStart(2, "0")}`;
    }
    return cleaned;
  });
  return normalizedParts.join(" -> ");
}

export function toSafeTimestamp(timestamp: string): string {
  return sanitizeTimestamp(normalizeTimestamp(timestamp));
}
