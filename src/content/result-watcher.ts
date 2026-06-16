import { findDownloadButtonForNewestResult, findLoadingIndicators, findResultCards } from "./dom-selectors";

export async function waitForReadyResult(options: {
  initialResultCount: number;
  timeoutMs: number;
}): Promise<HTMLButtonElement> {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const check = () => {
      if (Date.now() - startedAt > options.timeoutMs) {
        observer.disconnect();
        reject(new Error("Timed out waiting for a ready result."));
        return;
      }

      const resultCount = findResultCards().length;
      const hasNewResult = resultCount > options.initialResultCount || resultCount > 0;
      const loading = findLoadingIndicators().length > 0;
      const downloadButton = findDownloadButtonForNewestResult();

      if (hasNewResult && !loading && downloadButton) {
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
