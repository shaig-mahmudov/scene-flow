import type { ExpectedExtension, QueueItem } from "../queue/queue-types";
import { sanitizeFolder, sanitizeSlug, sanitizeTimestamp } from "../utils/sanitize";

export function buildTargetFilename(item: Pick<QueueItem, "index" | "safeTimestamp" | "safeTitle" | "outputFolder" | "subFolder" | "expectedExtension">): string {
  const index = String(item.index).padStart(3, "0");
  const title = item.safeTitle ? `_${item.safeTitle}` : "";
  const sub = item.subFolder ? `${sanitizeFolder(item.subFolder)}/` : "";
  return `${sanitizeFolder(item.outputFolder)}/${sub}${index}_${item.safeTimestamp}${title}.${item.expectedExtension}`;
}

export function buildQueueTargetFilename(input: {
  index: number;
  timestamp: string;
  title?: string;
  outputFolder: string;
  subFolder?: string;
  expectedExtension: ExpectedExtension;
}): string {
  return buildTargetFilename({
    index: input.index,
    safeTimestamp: sanitizeTimestamp(input.timestamp),
    safeTitle: input.title ? sanitizeSlug(input.title) : undefined,
    outputFolder: input.outputFolder,
    subFolder: input.subFolder,
    expectedExtension: input.expectedExtension
  });
}
