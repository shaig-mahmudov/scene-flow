import { loadCurrentItem, setCurrentItem } from "../core/queue/queue-store";

export function installDownloadRouter(): void {
  chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
    void routeDownload(downloadItem, suggest);
    return true;
  });
}

async function routeDownload(
  _downloadItem: chrome.downloads.DownloadItem,
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
}
