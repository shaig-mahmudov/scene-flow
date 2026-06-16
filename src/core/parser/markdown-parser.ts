import type { ParsedPrompt, ParseResult, ParseWarning } from "../queue/queue-types";
import { sanitizeSlug } from "../utils/sanitize";
import { isValidTimestamp, normalizeTimestamp, TIMESTAMP_BLOCK_RE, toSafeTimestamp } from "./timestamp";

export class MarkdownParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarkdownParseError";
  }
}

type MatchInfo = {
  match: RegExpExecArray;
  time: string;
  title?: string;
};

export function parseMarkdownPrompts(markdown: string): ParseResult {
  if (!markdown.trim()) {
    throw new MarkdownParseError("The Markdown file is empty.");
  }

  const matches = collectTimestampMatches(markdown);
  if (matches.length === 0) {
    throw new MarkdownParseError("No timestamp blocks found. Use lines like [00:00] scene_title.");
  }

  const warnings: ParseWarning[] = [];
  const seenTimestamps = new Set<string>();
  const prompts: ParsedPrompt[] = matches.map((entry, offset) => {
    if (!isValidTimestamp(entry.time)) {
      throw new MarkdownParseError(`Invalid timestamp: ${entry.time}`);
    }

    const normalizedTimestamp = normalizeTimestamp(entry.time);
    if (seenTimestamps.has(normalizedTimestamp)) {
      warnings.push({
        code: "duplicate_timestamp",
        message: `Duplicate timestamp found: ${normalizedTimestamp}`,
        timestamp: normalizedTimestamp
      });
    }
    seenTimestamps.add(normalizedTimestamp);

    const bodyStart = entry.match.index + entry.match[0].length;
    const bodyEnd = matches[offset + 1]?.match.index ?? markdown.length;
    const prompt = markdown.slice(bodyStart, bodyEnd).trim();
    if (!prompt) {
      throw new MarkdownParseError(`Prompt body is empty for ${normalizedTimestamp}.`);
    }
    if (prompt.length < 3) {
      throw new MarkdownParseError(`Prompt body is too short for ${normalizedTimestamp}.`);
    }

    const title = entry.title?.trim();
    const safeTitle = title ? sanitizeSlug(title) : undefined;

    return {
      index: offset + 1,
      timestamp: normalizedTimestamp,
      safeTimestamp: toSafeTimestamp(normalizedTimestamp),
      title,
      safeTitle,
      prompt
    };
  });

  return { prompts, warnings };
}

function collectTimestampMatches(markdown: string): MatchInfo[] {
  TIMESTAMP_BLOCK_RE.lastIndex = 0;
  const matches: MatchInfo[] = [];
  let match: RegExpExecArray | null;

  while ((match = TIMESTAMP_BLOCK_RE.exec(markdown)) !== null) {
    const time = match.groups?.time;
    if (!time) continue;
    matches.push({
      match,
      time,
      title: match.groups?.title
    });
  }

  return matches;
}
