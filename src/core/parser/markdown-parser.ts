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

function parseParagraphPrompts(markdown: string): ParsedPrompt[] {
  const blocks = markdown.split(/\r?\n\s*\r?\n/).map(b => b.trim()).filter(b => b.length > 0);
  return blocks.map((block, index) => {
    if (block.length < 3) {
      throw new MarkdownParseError(`Prompt body is too short for block ${index + 1}.`);
    }
    const padIndex = String(index + 1).padStart(3, "0");
    const timestamp = `${padIndex}_Scene`;
    return {
      index: index + 1,
      timestamp,
      safeTimestamp: timestamp,
      title: undefined,
      safeTitle: undefined,
      prompt: block
    };
  });
}

export function parseMarkdownPrompts(markdown: string, globalStyle?: string): ParseResult {
  if (!markdown.trim()) {
    throw new MarkdownParseError("The Markdown file is empty.");
  }

  const matches = collectTimestampMatches(markdown);
  const warnings: ParseWarning[] = [];
  let prompts: ParsedPrompt[];

  if (matches.length === 0) {
    prompts = parseParagraphPrompts(markdown);
  } else {
    const seenTimestamps = new Set<string>();
    prompts = matches.map((entry, offset) => {
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
      const body = markdown.slice(bodyStart, bodyEnd).trim();

      let title: string | undefined;
      let prompt: string;

      if (body) {
        title = entry.title?.trim();
        prompt = body;
      } else {
        title = undefined;
        prompt = entry.title?.trim() ?? "";
      }

      if (!prompt) {
        throw new MarkdownParseError(`Prompt body is empty for ${normalizedTimestamp}.`);
      }
      if (prompt.length < 3) {
        throw new MarkdownParseError(`Prompt body is too short for ${normalizedTimestamp}.`);
      }

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
  }

  if (globalStyle && globalStyle.trim()) {
    const cleanStyle = globalStyle.trim();
    prompts = prompts.map(p => ({
      ...p,
      prompt: `${cleanStyle} ${p.prompt}`
    }));
  }

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
