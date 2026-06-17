import { loadCurrentItem, loadQueue, saveQueue, setCurrentItem } from "../core/queue/queue-store";
import type { QueueItem } from "../core/queue/queue-types";

export type DownloadVerificationResult =
  | { ok: true; downloadId: number; filename?: string }
  | { ok: false; error: string };

export type DownloadWatch = {
  done: Promise<DownloadVerificationResult>;
  cancel: () => void;
};

type RoutedDownload = {
  downloadId: number;
  filename: string;
};

const routedDownloadWaiters = new Map<string, Set<(download: RoutedDownload) => void>>();

export function installDownloadRouter(): void {
  chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
    void routeDownload(downloadItem, suggest);
    return true;
  });
}

async function routeDownload(
  downloadItem: chrome.downloads.DownloadItem,
  suggest: (suggestion?: chrome.downloads.DownloadFilenameSuggestion) => void
): Promise<void> {
  const item = await loadCurrentItem();
  if (!item) {
    suggest();
    return;
  }

  suggest({
    filename: item.targetFilename,
    conflictAction: "uniquify"
  });
  await setCurrentItem(null);
  resolveRoutedDownload(item.id, {
    downloadId: downloadItem.id,
    filename: item.targetFilename
  });
  await saveDownloadMetadata(item.id, downloadItem.id);
}

export function watchRoutedDownload(item: QueueItem, timeoutMs: number): DownloadWatch {
  let removeRouteWaiter: (() => void) | undefined;
  let completionWatch: DownloadWatch | undefined;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let settled = false;

  const done = new Promise<DownloadVerificationResult>((resolve) => {
    const settle = (result: DownloadVerificationResult): void => {
      if (settled) return;
      settled = true;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      removeRouteWaiter?.();
      completionWatch?.cancel();
      resolve(result);
    };

    timeoutId = setTimeout(() => {
      settle({
        ok: false,
        error: `Chrome did not start a download for ${item.targetFilename}.`
      });
    }, timeoutMs);

    removeRouteWaiter = addRoutedDownloadWaiter(item.id, (download) => {
      completionWatch = watchDownloadCompletion(download.downloadId, timeoutMs, download.filename);
      completionWatch.done.then(settle);
    });
  });

  return {
    done,
    cancel: () => {
      if (settled) return;
      settled = true;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      removeRouteWaiter?.();
      completionWatch?.cancel();
    }
  };
}

export function watchDownloadCompletion(
  downloadId: number,
  timeoutMs: number,
  expectedFilename?: string
): DownloadWatch {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let onChanged: ((delta: chrome.downloads.DownloadDelta) => void) | undefined;
  let settled = false;

  const done = new Promise<DownloadVerificationResult>((resolve) => {
    const settle = (result: DownloadVerificationResult): void => {
      if (settled) return;
      settled = true;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      if (onChanged) chrome.downloads.onChanged.removeListener(onChanged);
      resolve(result);
    };

    onChanged = (delta: chrome.downloads.DownloadDelta): void => {
      if (delta.id !== downloadId) return;
      if (delta.state?.current === "complete") {
        void resolveCompletedDownload(downloadId).then((result) => {
          if (result) settle(result);
        });
      }
      if (delta.state?.current === "interrupted") {
        settle({
          ok: false,
          error: `Chrome interrupted the download${delta.error?.current ? `: ${delta.error.current}` : "."}`
        });
      }
    };

    chrome.downloads.onChanged.addListener(onChanged);
    timeoutId = setTimeout(() => {
      settle({
        ok: false,
        error: `Chrome did not finish downloading ${expectedFilename ?? `download ${downloadId}`} before the timeout.`
      });
    }, timeoutMs);

    void resolveCompletedDownload(downloadId).then((result) => {
      if (result) settle(result);
    });
  });

  return {
    done,
    cancel: () => {
      if (settled) return;
      settled = true;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      if (onChanged) chrome.downloads.onChanged.removeListener(onChanged);
    }
  };
}

function addRoutedDownloadWaiter(itemId: string, callback: (download: RoutedDownload) => void): () => void {
  const waiters = routedDownloadWaiters.get(itemId) ?? new Set();
  waiters.add(callback);
  routedDownloadWaiters.set(itemId, waiters);

  return () => {
    waiters.delete(callback);
    if (waiters.size === 0) routedDownloadWaiters.delete(itemId);
  };
}

function resolveRoutedDownload(itemId: string, download: RoutedDownload): void {
  const waiters = routedDownloadWaiters.get(itemId);
  if (!waiters) return;

  for (const waiter of waiters) {
    waiter(download);
  }
  routedDownloadWaiters.delete(itemId);
}

async function resolveCompletedDownload(downloadId: number): Promise<DownloadVerificationResult | null> {
  const [download] = await chrome.downloads.search({ id: downloadId });
  if (!download) return null;
  if (download.state === "interrupted") {
    return {
      ok: false,
      error: `Chrome interrupted the download${download.error ? `: ${download.error}` : "."}`
    };
  }
  if (download.state !== "complete") return null;

  return {
    ok: true,
    downloadId,
    filename: download.filename
  };
}

async function saveDownloadMetadata(itemId: string, downloadId: number, downloadedFilename?: string): Promise<void> {
  const queue = await loadQueue();
  await saveQueue(
    queue.map((item) =>
      item.id === itemId
        ? {
            ...item,
            downloadId,
            downloadedFilename: downloadedFilename ?? item.downloadedFilename
          }
        : item
    )
  );
}
