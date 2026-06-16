import {
  findDownloadButtonForNewestResult,
  findGeneratedMediaElements,
  findLoadingIndicators,
  findResultCards
} from "./dom-selectors";

export type ResultReadiness = {
  ready: boolean;
  hasDownloadButton: boolean;
  downloadButton: HTMLElement | null;
};

export function getResultReadiness(options: {
  initialResultCount: number;
  initialMediaCount: number;
  submittedAt: number;
}): ResultReadiness {
  const resultCount = findResultCards().length;
  const mediaCount = findGeneratedMediaElements().length;
  const hasNewResult = resultCount > options.initialResultCount;
  const hasNewMedia = mediaCount > options.initialMediaCount;
  const loading = findLoadingIndicators().length > 0;
  const downloadButton = findDownloadButtonForNewestResult();
  const stabilized = Date.now() - options.submittedAt > 5000;

  return {
    ready: !loading && (Boolean(downloadButton) || (stabilized && (hasNewResult || hasNewMedia))),
    hasDownloadButton: Boolean(downloadButton),
    downloadButton
  };
}

export async function waitForReadyResult(options: {
  initialResultCount: number;
  initialMediaCount: number;
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
