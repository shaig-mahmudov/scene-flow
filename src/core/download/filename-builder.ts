import type { ExpectedExtension, QueueItem } from "../queue/queue-types";
import { sanitizeFolder, sanitizeSlug, sanitizeTimestamp } from "../utils/sanitize";

export function buildTargetFilename(item: Pick<QueueItem, "index" | "safeTimestamp" | "safeTitle" | "outputFolder" | "expectedExtension">): string {
  const index = String(item.index).padStart(3, "0");
  const title = item.safeTitle ? `_${item.safeTitle}` : "";
  return `${sanitizeFolder(item.outputFolder)}/${index}_${item.safeTimestamp}${title}.${item.expectedExtension}`;
}

export function buildQueueTargetFilename(input: {
  index: number;
  timestamp: string;
  title?: string;
  outputFolder: string;
  expectedExtension: ExpectedExtension;
}): string {
  return buildTargetFilename({
    index: input.index,
    safeTimestamp: sanitizeTimestamp(input.timestamp),
    safeTitle: input.title ? sanitizeSlug(input.title) : undefined,
    outputFolder: input.outputFolder,
    expectedExtension: input.expectedExtension
  });
}
