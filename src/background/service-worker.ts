import { DEFAULT_SETTINGS } from "../core/config/defaults";
import { isRunnableFlowProjectUrl, supportedFlowUrlMessage } from "../core/config/supported-flow";
import type { ContentAutomationResult, ExtensionMessage } from "../core/messaging/messages";
import {
  loadQueue,
  loadRunnerState,
  loadSettings,
  loadTargetTab,
  saveQueue,
  saveRunnerState,
  saveTargetTab,
  setCurrentItem
} from "../core/queue/queue-store";
import { createInitialRunnerState, updateItemStatus } from "../core/queue/queue-state-machine";
import type { QueueItem, RunnerState, SceneFlowSettings } from "../core/queue/queue-types";
import { installDownloadRouter } from "./download-router";

let runnerActive = false;

installDownloadRouter();

chrome.runtime.onInstalled.addListener(() => {
  void ensureInitialState();
});

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((error: unknown) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : "Unknown background error." });
    });
  return true;
});

async function ensureInitialState(): Promise<void> {
  const settings = await loadSettings();
  await chrome.storage.local.set({
    "sceneFlow.settings": { ...DEFAULT_SETTINGS, ...settings }
  });
  const state = await loadRunnerState();
  await saveRunnerState(state);
}

async function handleMessage(message: ExtensionMessage): Promise<unknown> {
  switch (message.type) {
    case "QUEUE_START":
    case "QUEUE_RESUME":
      {
        const targetResult = await ensureFlowTargetTab();
        if (!targetResult.ok) return targetResult;
      }
      void runQueue();
      return { ok: true };
    case "QUEUE_PAUSE":
      await saveRunnerState({ ...(await loadRunnerState()), pauseRequested: true, updatedAt: Date.now() });
      return { ok: true };
    case "QUEUE_STOP":
      await saveRunnerState({ ...(await loadRunnerState()), stopRequested: true, status: "stopping", updatedAt: Date.now() });
      return { ok: true };
    case "QUEUE_RESET":
      await saveQueue([]);
      await setCurrentItem(null);
      await saveRunnerState(createInitialRunnerState());
      return { ok: true };
    case "QUEUE_RETRY_FAILED":
      await retryFailedItems();
      return { ok: true };
    case "OPEN_CONTROL_WINDOW":
      await captureActiveFlowTabTarget();
      await openControlWindow();
      return { ok: true };
    default:
      return { ok: false, error: `Unhandled message: ${message.type}` };
  }
}

async function retryFailedItems(): Promise<void> {
  const queue = await loadQueue();
  await saveQueue(
    queue.map((item) =>
      item.status === "failed" || item.status === "cancelled"
        ? updateItemStatus(item, "pending", { attempts: 0, error: undefined, completedAt: undefined })
        : item
    )
  );
  await setCurrentItem(null);
  await saveRunnerState(createInitialRunnerState("ready"));
}

async function runQueue(): Promise<void> {
  if (runnerActive) return;
  runnerActive = true;

  try {
    let state = await loadRunnerState();
    await saveRunnerState({ ...state, status: "running", pauseRequested: false, stopRequested: false, updatedAt: Date.now() });

    while (true) {
      state = await loadRunnerState();
      if (state.stopRequested) {
        await cancelRemaining();
        return;
      }
      if (state.pauseRequested) {
        await saveRunnerState({ ...state, status: "paused", activeItemId: undefined, updatedAt: Date.now() });
        return;
      }

      const queue = await loadQueue();
      const failedItem = queue.find((candidate) => candidate.status === "failed");
      if (failedItem) {
        await saveRunnerState({
          ...state,
          status: "paused",
          activeItemId: failedItem.id,
          pauseRequested: true,
          error: failedItem.error,
          updatedAt: Date.now()
        });
        return;
      }

      const item = queue.find((candidate) => candidate.status === "pending" || candidate.status === "paused");
      if (!item) {
        await saveRunnerState({ ...state, status: "completed", activeItemId: undefined, updatedAt: Date.now() });
        if (queue.length > 0 && queue.every((candidate) => candidate.status === "done")) {
          await notifyQueueCompleted(queue);
        }
        return;
      }

      await processItem(item);
    }
  } finally {
    runnerActive = false;
  }
}

async function processItem(item: QueueItem): Promise<void> {
  const settings = await loadSettings();
  await patchQueueItem(item.id, (current) =>
    updateItemStatus(current, "running", { attempts: current.attempts + 1, error: undefined })
  );
  await saveRunnerState(runningState(item.id));

  const maxWaitMs = settings.maxWaitMinutesPerPrompt * 60 * 1000;
  const submitResult = await sendToActiveFlowTab({ type: "SUBMIT_PROMPT", item, maxWaitMs });
  if (!submitResult.ok) {
    await handleFailure(item.id, submitResult.error, settings);
    return;
  }
  if (!submitResult.clickPoint) {
    await handleFailure(item.id, "Could not locate the active Flow send button.", settings);
    return;
  }

  const clickResult = await clickActiveFlowTabAt(submitResult.clickPoint);
  if (!clickResult.ok) {
    await handleFailure(item.id, clickResult.error, settings);
    return;
  }

  await patchQueueItem(item.id, (current) => updateItemStatus(current, "waiting_result"));
  const readyResult = await waitForResultReady(item, maxWaitMs);
  if (!readyResult.ok) {
    await handleFailure(item.id, readyResult.error, settings);
    return;
  }

  await patchQueueItem(item.id, (current) => updateItemStatus(current, "downloading"));
  const currentItem = (await loadQueue()).find((candidate) => candidate.id === item.id);
  if (currentItem) await setCurrentItem(currentItem);

  const downloadResult = await triggerFlowDownload(item, readyResult);
  if (!downloadResult.ok) {
    await setCurrentItem(null);
    await handleFailure(item.id, downloadResult.error, settings);
    return;
  }

  await patchQueueItem(item.id, (current) => updateItemStatus(current, "cooldown"));
  await sleep(settings.cooldownSeconds * 1000);

  const state = await loadRunnerState();
  if (state.stopRequested) {
    await cancelRemaining();
    return;
  }
  if (state.pauseRequested) {
    await patchQueueItem(item.id, (current) => updateItemStatus(current, "done"));
    await saveRunnerState({ ...state, status: "paused", activeItemId: undefined, updatedAt: Date.now() });
    return;
  }

  await patchQueueItem(item.id, (current) => updateItemStatus(current, "done"));
}

async function triggerFlowDownload(
  item: QueueItem,
  readyResult: Extract<ContentAutomationResult, { ok: true }>
): Promise<ContentAutomationResult> {
  if (readyResult.downloadClickPoint) {
    const downloadClickResult = await clickActiveFlowTabAt(readyResult.downloadClickPoint);
    if (!downloadClickResult.ok) return downloadClickResult;
    return selectOriginalDownloadSize(item);
  }

  if (readyResult.revealPoint) {
    const hoverResult = await hoverActiveFlowTabAt(readyResult.revealPoint);
    if (!hoverResult.ok) return hoverResult;
    await sleep(700);
  }

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const buttonResult = await sendToActiveFlowTab({ type: "GET_DOWNLOAD_BUTTON", item });
    if (!buttonResult.ok) return buttonResult;
    if (buttonResult.downloadClickPoint) {
      const downloadClickResult = await clickActiveFlowTabAt(buttonResult.downloadClickPoint);
      if (!downloadClickResult.ok) return downloadClickResult;
      return selectOriginalDownloadSize(item);
    }
    if (buttonResult.menuClickPoint) {
      const menuResult = await clickActiveFlowTabAt(buttonResult.menuClickPoint);
      if (!menuResult.ok) return menuResult;
      await sleep(700);
    }
    await sleep(700);
  }

  return downloadNewestMediaDirectly(item);
}

async function selectOriginalDownloadSize(item: QueueItem): Promise<ContentAutomationResult> {
  await sleep(700);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const sizeResult = await sendToActiveFlowTab({ type: "GET_DOWNLOAD_SIZE_OPTION", item });
    if (!sizeResult.ok) return sizeResult;
    if (sizeResult.sizeClickPoint) {
      return clickActiveFlowTabAt(sizeResult.sizeClickPoint);
    }
    await sleep(500);
  }

  return {
    ok: false,
    error: "Download menu opened, but Scene Flow could not find the 1K/original size option."
  };
}

async function downloadNewestMediaDirectly(item: QueueItem): Promise<ContentAutomationResult> {
  const sourceResult = await sendToActiveFlowTab({ type: "GET_NEWEST_MEDIA_SOURCE", item });
  if (!sourceResult.ok) return sourceResult;
  if (!sourceResult.mediaUrl) {
    return {
      ok: false,
      error:
        "Generated media was detected, but Scene Flow could not find a download button or media URL."
    };
  }

  try {
    await chrome.downloads.download({
      url: sourceResult.mediaUrl,
      filename: item.targetFilename,
      conflictAction: "uniquify",
      saveAs: false
    });
    return { ok: true, itemId: item.id };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? `Direct media download failed: ${error.message}`
          : "Direct media download failed."
    };
  }
}

async function waitForResultReady(item: QueueItem, maxWaitMs: number): Promise<ContentAutomationResult> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < maxWaitMs) {
    const state = await loadRunnerState();
    if (state.stopRequested) return { ok: false, itemId: item.id, error: "Queue was stopped while waiting for the result." };

    const result = await sendToActiveFlowTab({ type: "CHECK_RESULT_READY", item });
    if (!result.ok) return result;
    if (result.ready) {
      return {
        ok: true,
        itemId: item.id,
        hasDownloadButton: result.hasDownloadButton,
        downloadClickPoint: result.downloadClickPoint,
        revealPoint: result.revealPoint
      };
    }

    await sleep(1500);
  }

  return { ok: false, itemId: item.id, error: "Timed out waiting for a ready result." };
}

async function handleFailure(itemId: string, error: string, settings: SceneFlowSettings): Promise<void> {
  const retry = await markFailureForRetry(itemId, error);
  if (!retry) {
    await saveRunnerState({
      ...(await loadRunnerState()),
      status: "paused",
      activeItemId: itemId,
      pauseRequested: true,
      stopRequested: false,
      error,
      updatedAt: Date.now()
    });
    return;
  }

  await sleep(retryDelayMs(settings));

  const state = await loadRunnerState();
  if (state.stopRequested) return;
  if (state.pauseRequested) {
    await patchQueueItem(itemId, (current) => updateItemStatus(current, "paused", { error }));
    return;
  }

  await patchQueueItem(itemId, (current) => updateItemStatus(current, "pending", { error }));
}

async function markFailureForRetry(itemId: string, error: string): Promise<boolean> {
  let retry = false;
  await patchQueueItem(itemId, (current) => {
    retry = current.attempts <= current.maxRetries;
    return retry
      ? updateItemStatus(current, "cooldown", { error })
      : updateItemStatus(current, "failed", { error });
  });
  return retry;
}

async function patchQueueItem(itemId: string, patcher: (item: QueueItem) => QueueItem): Promise<void> {
  const queue = await loadQueue();
  await saveQueue(queue.map((item) => (item.id === itemId ? patcher(item) : item)));
}

async function cancelRemaining(): Promise<void> {
  const queue = await loadQueue();
  await saveQueue(
    queue.map((item) =>
      item.status === "pending" ||
      item.status === "paused" ||
      item.status === "running" ||
      item.status === "waiting_result" ||
      item.status === "downloading" ||
      item.status === "cooldown"
        ? updateItemStatus(item, "cancelled")
        : item
    )
  );
  await setCurrentItem(null);
  await saveRunnerState(createInitialRunnerState("idle"));
}

async function notifyQueueCompleted(queue: QueueItem[]): Promise<void> {
  const doneCount = queue.filter((item) => item.status === "done").length;
  const itemLabel = doneCount === 1 ? "task" : "tasks";

  try {
    await chrome.notifications.create("scene-flow-queue-completed", {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
      title: "Scene Flow completed",
      message: `All ${doneCount} ${itemLabel} are done.`
    });
  } catch {
    // Notifications are nice-to-have; queue completion should remain successful if Chrome suppresses one.
  }
}

async function sendToActiveFlowTab(message: ExtensionMessage): Promise<ContentAutomationResult> {
  const tab = await getTargetFlowTab();
  if (!tab?.id || !isRunnableFlowProjectUrl(tab.url)) {
    return { ok: false, error: supportedFlowUrlMessage() };
  }

  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not communicate with the Google Flow page."
    };
  }
}

async function clickActiveFlowTabAt(point: { x: number; y: number }): Promise<ContentAutomationResult> {
  const tab = await getTargetFlowTab();
  if (!tab?.id || !isRunnableFlowProjectUrl(tab.url)) {
    return { ok: false, error: supportedFlowUrlMessage() };
  }

  const target: chrome.debugger.Debuggee = { tabId: tab.id };
  try {
    await chrome.debugger.attach(target, "1.3");
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x,
      y: point.y
    });
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button: "left",
      buttons: 1,
      clickCount: 1
    });
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: point.x,
      y: point.y,
      button: "left",
      buttons: 0,
      clickCount: 1
    });
    return { ok: true, itemId: "" };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Chrome could not dispatch a real click to the Flow send button."
    };
  } finally {
    try {
      await chrome.debugger.detach(target);
    } catch {
      // Detach can fail if attach did not complete; the click result above is the useful error.
    }
  }
}

async function hoverActiveFlowTabAt(point: { x: number; y: number }): Promise<ContentAutomationResult> {
  const tab = await getTargetFlowTab();
  if (!tab?.id || !isRunnableFlowProjectUrl(tab.url)) {
    return { ok: false, error: supportedFlowUrlMessage() };
  }

  const target: chrome.debugger.Debuggee = { tabId: tab.id };
  try {
    await chrome.debugger.attach(target, "1.3");
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x,
      y: point.y
    });
    return { ok: true, itemId: "" };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Chrome could not reveal Flow result actions."
    };
  } finally {
    try {
      await chrome.debugger.detach(target);
    } catch {
      // Detach can fail if attach did not complete; the hover result above is the useful error.
    }
  }
}

async function getActiveFlowTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function ensureFlowTargetTab(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (await captureActiveFlowTabTarget()) return { ok: true };
  if (await getStoredFlowTab()) return { ok: true };
  if (await captureAnyFlowTabTarget()) return { ok: true };
  return { ok: false, error: supportedFlowUrlMessage() };
}

async function getTargetFlowTab(): Promise<chrome.tabs.Tab | undefined> {
  return (await getStoredFlowTab()) ?? (await captureActiveFlowTabTarget()) ?? (await captureAnyFlowTabTarget());
}

async function getStoredFlowTab(): Promise<chrome.tabs.Tab | undefined> {
  const target = await loadTargetTab();
  if (!target) return undefined;

  try {
    const tab = await chrome.tabs.get(target.tabId);
    if (tab.id && isRunnableFlowProjectUrl(tab.url)) return tab;
  } catch {
    // The stored tab was closed or Chrome no longer exposes it.
  }

  await saveTargetTab(null);
  return undefined;
}

async function captureActiveFlowTabTarget(): Promise<chrome.tabs.Tab | undefined> {
  const tab = await getActiveFlowTab();
  if (!tab?.id || !isRunnableFlowProjectUrl(tab.url)) return undefined;

  await saveFlowTargetTab(tab);
  return tab;
}

async function captureAnyFlowTabTarget(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({});
  const tab = tabs.find((candidate) => candidate.id && isRunnableFlowProjectUrl(candidate.url));
  if (!tab?.id) return undefined;

  await saveFlowTargetTab(tab);
  return tab;
}

async function saveFlowTargetTab(tab: chrome.tabs.Tab): Promise<void> {
  if (!tab.id) return;

  await saveTargetTab({
    tabId: tab.id,
    windowId: tab.windowId,
    url: tab.url,
    capturedAt: Date.now()
  });
}

async function openControlWindow(): Promise<void> {
  await chrome.windows.create({
    url: chrome.runtime.getURL("src/popup/popup.html?mode=window"),
    type: "popup",
    width: 460,
    height: 720,
    focused: true
  });
}

function runningState(activeItemId: string): RunnerState {
  return {
    status: "running",
    activeItemId,
    pauseRequested: false,
    stopRequested: false,
    updatedAt: Date.now()
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(settings: SceneFlowSettings): number {
  return Math.max(3000, settings.cooldownSeconds * 1000);
}
