import { DEFAULT_SETTINGS } from "../core/config/defaults";
import { isRunnableFlowProjectUrl, supportedFlowUrlMessage } from "../core/config/supported-flow";
import type { ContentAutomationResult, ExtensionMessage } from "../core/messaging/messages";
import {
  loadQueue,
  loadRunnerState,
  loadSettings,
  saveQueue,
  saveRunnerState,
  setCurrentItem
} from "../core/queue/queue-store";
import { createInitialRunnerState, updateItemStatus } from "../core/queue/queue-state-machine";
import type { QueueItem, RunnerState } from "../core/queue/queue-types";
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
      const item = queue.find((candidate) => candidate.status === "pending" || candidate.status === "paused");
      if (!item) {
        await saveRunnerState({ ...state, status: "completed", activeItemId: undefined, updatedAt: Date.now() });
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
    await handleFailure(item.id, submitResult.error);
    return;
  }
  if (!submitResult.clickPoint) {
    await handleFailure(item.id, "Could not locate the active Flow send button.");
    return;
  }

  const clickResult = await clickActiveFlowTabAt(submitResult.clickPoint);
  if (!clickResult.ok) {
    await handleFailure(item.id, clickResult.error);
    return;
  }

  await patchQueueItem(item.id, (current) => updateItemStatus(current, "waiting_result"));
  const readyResult = await waitForResultReady(item, maxWaitMs);
  if (!readyResult.ok) {
    await handleFailure(item.id, readyResult.error);
    return;
  }

  if (readyResult.hasDownloadButton) {
    await patchQueueItem(item.id, (current) => updateItemStatus(current, "downloading"));
    const currentItem = (await loadQueue()).find((candidate) => candidate.id === item.id);
    if (currentItem) await setCurrentItem(currentItem);

    const downloadResult = await sendToActiveFlowTab({ type: "TRIGGER_DOWNLOAD", item, maxWaitMs });
    if (!downloadResult.ok) {
      await setCurrentItem(null);
      await handleFailure(item.id, downloadResult.error);
      return;
    }
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

async function waitForResultReady(item: QueueItem, maxWaitMs: number): Promise<ContentAutomationResult> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < maxWaitMs) {
    const state = await loadRunnerState();
    if (state.stopRequested) return { ok: false, itemId: item.id, error: "Queue was stopped while waiting for the result." };

    const result = await sendToActiveFlowTab({ type: "CHECK_RESULT_READY", item });
    if (!result.ok) return result;
    if (result.ready) return { ok: true, itemId: item.id };

    await sleep(1500);
  }

  return { ok: false, itemId: item.id, error: "Timed out waiting for a ready result." };
}

async function handleFailure(itemId: string, error: string): Promise<void> {
  await patchQueueItem(itemId, (current) => {
    if (current.attempts <= current.maxRetries) {
      return updateItemStatus(current, "pending", { error });
    }
    return updateItemStatus(current, "failed", { error });
  });
}

async function patchQueueItem(itemId: string, patcher: (item: QueueItem) => QueueItem): Promise<void> {
  const queue = await loadQueue();
  await saveQueue(queue.map((item) => (item.id === itemId ? patcher(item) : item)));
}

async function cancelRemaining(): Promise<void> {
  const queue = await loadQueue();
  await saveQueue(
    queue.map((item) =>
      item.status === "pending" || item.status === "paused" || item.status === "running"
        ? updateItemStatus(item, "cancelled")
        : item
    )
  );
  await setCurrentItem(null);
  await saveRunnerState(createInitialRunnerState("idle"));
}

async function sendToActiveFlowTab(message: ExtensionMessage): Promise<ContentAutomationResult> {
  const tab = await getActiveFlowTab();
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
  const tab = await getActiveFlowTab();
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

async function getActiveFlowTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
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
