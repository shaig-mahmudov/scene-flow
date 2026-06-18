import {
  findDownloadButtonForNewestResult,
  findGeneratedMediaElements,
  findLoadingIndicators,
  findNewestGeneratedMediaElement,
  findNewestGeneratedMediaSource,
  findResultCards
} from "./dom-selectors";

export type ResultReadiness = {
  ready: boolean;
  hasDownloadButton: boolean;
  downloadButton: HTMLElement | null;
  revealTarget: HTMLElement | null;
};

export function getResultReadiness(options: {
  initialResultCount: number;
  initialMediaCount: number;
  initialMediaSource?: string;
  submittedAt: number;
}): ResultReadiness {
  const resultCount = findResultCards().length;
  const mediaCount = findGeneratedMediaElements().length;
  const hasNewResult = resultCount > options.initialResultCount;
  const hasNewMedia = mediaCount > options.initialMediaCount;
  const loading = findLoadingIndicators().length > 0;
  const downloadButton = findDownloadButtonForNewestResult();
  const revealTarget = findNewestGeneratedMediaElement() ?? findResultCards().at(-1) ?? null;
  const newestMediaSource = findNewestGeneratedMediaSource();
  const hasNewMediaSource = Boolean(newestMediaSource && newestMediaSource !== options.initialMediaSource);
  const stabilized = Date.now() - options.submittedAt > 5000;
  const longStabilized = Date.now() - options.submittedAt > 12_000;
  const hasVisibleResult = hasNewResult || hasNewMedia || hasNewMediaSource;

  return {
    ready: Boolean(downloadButton) || (stabilized && (hasNewMedia || hasNewMediaSource)) || (!loading && stabilized && hasNewResult) || (longStabilized && hasVisibleResult),
    hasDownloadButton: Boolean(downloadButton),
    downloadButton,
    revealTarget
  };
}

export async function waitForReadyResult(options: {
  initialResultCount: number;
  initialMediaCount: number;
  initialMediaSource?: string;
  submittedAt: number;
  timeoutMs: number;
}): Promise<HTMLElement> {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const check = () => {
      if (Date.now() - startedAt > options.timeoutMs) {
        observer.disconnect();
        reject(new Error("Timed out waiting for a ready result."));
        return;
      }

      const readiness = getResultReadiness(options);
      const downloadButton = readiness.downloadButton;

      if (downloadButton) {
        window.setTimeout(() => {
          observer.disconnect();
          resolve(downloadButton);
        }, 750);
      }
    };

    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    check();
  });
}
