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
import type { QueueItem, QueueStatus, RunnerState, SceneFlowSettings } from "../core/queue/queue-types";
import {
  checkDownloadCompletion,
  installDownloadRouter,
  type DownloadVerificationResult
} from "./download-router";

const RUNNER_ALARM_NAME = "scene-flow-runner-watchdog";
const RUNNER_ALARM_PERIOD_MINUTES = 1.0;
const RUNNER_ALARM_DELAY_MINUTES = 1.0;
const CHECKPOINT_POLL_DELAY_MS = 2_000;
const DOWNLOAD_ROUTE_WAIT_MS = 60_000;

let runnerActive = false;

type ProcessResult = "continue" | "defer";
type DeferredResult = { defer: true };

installDownloadRouter(resumeSavedQueueIfNeeded);

chrome.runtime.onInstalled.addListener(() => {
  void ensureInitialState().then(resumeSavedQueueIfNeeded);
});

chrome.runtime.onStartup.addListener(() => {
  void resumeSavedQueueIfNeeded();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== RUNNER_ALARM_NAME) return;
  void resumeSavedQueueIfNeeded();
});

chrome.downloads.onChanged.addListener((delta) => {
  if (delta.state?.current === "complete" || delta.state?.current === "interrupted") {
    void resumeSavedQueueIfNeeded();
  }
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
      await armRunnerWatchdog();
      void runQueue();
      return { ok: true };
    case "QUEUE_PAUSE":
      await saveRunnerState({ ...(await loadRunnerState()), pauseRequested: true, updatedAt: Date.now() });
      return { ok: true };
    case "QUEUE_STOP":
      await saveRunnerState({ ...(await loadRunnerState()), stopRequested: true, status: "stopping", updatedAt: Date.now() });
      return { ok: true };
    case "QUEUE_RESET":
      await disarmRunnerWatchdog();
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
        ? updateItemStatus(item, "pending", {
            attempts: 0,
            error: undefined,
            completedAt: undefined,
            downloadId: undefined,
            downloadedFilename: undefined,
            checkpointStartedAt: undefined,
            nextRunAt: undefined,
            submittedAt: undefined,
            initialResultCount: undefined,
            initialMediaCount: undefined,
            initialMediaSource: undefined,
            downloadRequestedAt: undefined
          })
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

      const item = queue.find(isRunnableQueueItem);
      if (!item) {
        await saveRunnerState({ ...state, status: "completed", activeItemId: undefined, updatedAt: Date.now() });
        if (queue.length > 0 && queue.every((candidate) => candidate.status === "done")) {
          await notifyQueueCompleted(queue);
        }
        return;
      }

      try {
        const result = await processItem(item);
        if (result === "defer") return;
      } catch (error) {
        await saveRunnerState({
          ...state,
          status: "paused",
          activeItemId: item.id,
          pauseRequested: true,
          error: error instanceof Error ? error.message : "An unexpected background error occurred.",
          updatedAt: Date.now()
        });
        return;
      }
    }
  } finally {
    runnerActive = false;
    await updateRunnerWatchdogForState();
  }
}

async function processItem(item: QueueItem): Promise<ProcessResult> {
  const settings = await loadSettings();
  await saveRunnerState(runningState(item.id));

  const maxWaitMs = settings.maxWaitMinutesPerPrompt * 60 * 1000;

  if (isCheckpointWaiting(item)) {
    scheduleRunnerWake((item.nextRunAt ?? Date.now()) - Date.now());
    return "defer";
  }

  if (item.status === "cooldown") {
    return recoverCooldownItem(item);
  }

  if (item.status === "waiting_result") {
    return waitForAndDownloadItem(item, settings, maxWaitMs);
  }

  if (item.status === "downloading") {
    return downloadReadyResult(item, settings, maxWaitMs);
  }

  await patchQueueItem(item.id, (current) =>
    updateItemStatus(current, "running", {
      attempts: item.status === "running" ? current.attempts : current.attempts + 1,
      error: undefined,
      nextRunAt: undefined,
      downloadRequestedAt: undefined
    })
  );

  const submitResult = await sendToActiveFlowTab({ type: "SUBMIT_PROMPT", item, maxWaitMs });
  if (!submitResult.ok) {
    await handleFailure(item.id, submitResult.error, settings);
    return "defer";
  }
  if (!submitResult.clickPoint) {
    await handleFailure(item.id, "Could not locate the active Flow send button.", settings);
    return "defer";
  }

  const clickResult = await clickActiveFlowTabAt(submitResult.clickPoint);
  if (!clickResult.ok) {
    await handleFailure(item.id, clickResult.error, settings);
    return "defer";
  }

  await patchQueueItem(item.id, (current) =>
    updateItemStatus(current, "waiting_result", {
      submittedAt: submitResult.submittedAt,
      initialResultCount: submitResult.initialResultCount,
      initialMediaCount: submitResult.initialMediaCount,
      initialMediaSource: submitResult.initialMediaSource,
      nextRunAt: undefined
    })
  );
  return "continue";
}

async function waitForAndDownloadItem(
  item: QueueItem,
  settings: SceneFlowSettings,
  maxWaitMs: number
): Promise<ProcessResult> {
  const readyResult = await checkResultReadyCheckpoint(item, maxWaitMs);
  if (isDeferredResult(readyResult)) return "defer";
  if (!readyResult.ok) {
    await handleFailure(item.id, readyResult.error, settings);
    return "defer";
  }

  return downloadReadyResult(item, settings, maxWaitMs, readyResult);
}

async function downloadReadyResult(
  item: QueueItem,
  settings: SceneFlowSettings,
  maxWaitMs: number,
  readyResult?: Extract<ContentAutomationResult, { ok: true }>
): Promise<ProcessResult> {
  if (item.status !== "downloading") {
    await patchQueueItem(item.id, (current) => updateItemStatus(current, "downloading", { nextRunAt: undefined }));
    item = (await loadQueue()).find((candidate) => candidate.id === item.id) ?? item;
  }

  if (isCheckpointTimedOut(item, downloadWaitMs(settings))) {
    await setCurrentItem(null);
    await handleFailure(item.id, "Timed out waiting for Chrome to finish the download.", settings);
    return "defer";
  }

  if (item.downloadId !== undefined) {
    const verifiedDownload = await checkDownloadCompletion(item.downloadId);
    if (verifiedDownload === null) {
      await scheduleItemResume(item.id, CHECKPOINT_POLL_DELAY_MS);
      return "defer";
    }
    if (!verifiedDownload.ok) {
      await setCurrentItem(null);
      await handleFailure(item.id, verifiedDownload.error, settings);
      return "defer";
    }

    return finishVerifiedDownload(item, settings, verifiedDownload);
  }

  if (item.downloadRequestedAt && Date.now() - item.downloadRequestedAt < DOWNLOAD_ROUTE_WAIT_MS) {
    await scheduleItemResume(item.id, CHECKPOINT_POLL_DELAY_MS);
    return "defer";
  }
  if (item.downloadRequestedAt) {
    await setCurrentItem(null);
    await patchQueueItem(item.id, (current) => ({
      ...current,
      downloadRequestedAt: undefined,
      nextRunAt: undefined
    }));
    item = (await loadQueue()).find((candidate) => candidate.id === item.id) ?? item;
  }

  const result = readyResult ?? (await checkResultReadyCheckpoint(item, maxWaitMs));
  if (isDeferredResult(result)) return "defer";
  if (!result.ok) {
    await setCurrentItem(null);
    await handleFailure(item.id, result.error, settings);
    return "defer";
  }

  const currentItem = (await loadQueue()).find((candidate) => candidate.id === item.id) ?? item;
  await setCurrentItem(currentItem);

  const downloadResult = await triggerFlowDownload(item, result);
  if (!downloadResult.ok) {
    await setCurrentItem(null);
    if (isTemporaryFlowCommunicationError(downloadResult.error)) {
      await scheduleItemResume(item.id, CHECKPOINT_POLL_DELAY_MS);
      return "defer";
    }
    await handleFailure(item.id, downloadResult.error, settings);
    return "defer";
  }

  if (downloadResult.downloadId !== undefined) {
    await patchQueueItem(item.id, (current) => ({ ...current, downloadId: downloadResult.downloadId }));
    return "continue";
  }

  await patchQueueItem(item.id, (current) => ({
    ...current,
    downloadRequestedAt: Date.now(),
    nextRunAt: Date.now() + CHECKPOINT_POLL_DELAY_MS
  }));
  return "defer";
}

async function finishVerifiedDownload(
  item: QueueItem,
  settings: SceneFlowSettings,
  verifiedDownload: Extract<DownloadVerificationResult, { ok: true }>
): Promise<ProcessResult> {
  const cooldownMs = settings.cooldownSeconds * 1000;
  await patchQueueItem(item.id, (current) =>
    updateItemStatus(current, "cooldown", {
      downloadId: verifiedDownload.downloadId,
      downloadedFilename: verifiedDownload.filename,
      error: undefined,
      downloadRequestedAt: undefined,
      nextRunAt: Date.now() + cooldownMs
    })
  );
  await setCurrentItem(null);
  if (cooldownMs > 0) scheduleRunnerWake(cooldownMs);
  return cooldownMs > 0 ? "defer" : "continue";
}

async function recoverCooldownItem(item: QueueItem): Promise<ProcessResult> {
  if (isCheckpointWaiting(item)) return "defer";

  if (item.error && item.attempts <= item.maxRetries) {
    await patchQueueItem(item.id, (current) =>
      updateItemStatus(current, "pending", {
        error: item.error,
        nextRunAt: undefined,
        downloadRequestedAt: undefined
      })
    );
    return "continue";
  }

  await patchQueueItem(item.id, (current) => updateItemStatus(current, "done", { nextRunAt: undefined }));
  return "continue";
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
    const downloadId = await chrome.downloads.download({
      url: sourceResult.mediaUrl,
      filename: item.targetFilename,
      conflictAction: "uniquify",
      saveAs: false
    });
    return { ok: true, itemId: item.id, downloadId };
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

async function checkResultReadyCheckpoint(
  item: QueueItem,
  maxWaitMs: number
): Promise<ContentAutomationResult | DeferredResult> {
  const startedAt = item.submittedAt ?? item.checkpointStartedAt ?? item.startedAt ?? Date.now();
  if (Date.now() - startedAt >= maxWaitMs) {
    return { ok: false, itemId: item.id, error: "Timed out waiting for a ready result." };
  }

  const state = await loadRunnerState();
  if (state.stopRequested) {
    return { ok: false, itemId: item.id, error: "Queue was stopped while waiting for the result." };
  }

  const result = await sendToActiveFlowTab({ type: "CHECK_RESULT_READY", item });
  if (!result.ok) {
    if (isTemporaryFlowCommunicationError(result.error)) {
      await scheduleItemResume(item.id, CHECKPOINT_POLL_DELAY_MS);
      return { defer: true };
    }
    return result;
  }
  if (!result.ready) {
    await scheduleItemResume(item.id, CHECKPOINT_POLL_DELAY_MS);
    return { defer: true };
  }

  return {
    ok: true,
    itemId: item.id,
    hasDownloadButton: result.hasDownloadButton,
    downloadClickPoint: result.downloadClickPoint,
    revealPoint: result.revealPoint
  };
}

async function handleFailure(itemId: string, error: string, settings: SceneFlowSettings): Promise<void> {
  const retry = await markFailureForRetry(itemId, error, settings);
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
}

async function markFailureForRetry(itemId: string, error: string, settings: SceneFlowSettings): Promise<boolean> {
  let retry = false;
  let nextRunMs = 0;
  await patchQueueItem(itemId, (current) => {
    const now = Date.now();
    retry = current.attempts <= current.maxRetries;
    nextRunMs = retryDelayMs(settings);
    return retry
      ? updateItemStatus(current, "cooldown", {
          error,
          downloadId: undefined,
          downloadedFilename: undefined,
          downloadRequestedAt: undefined,
          nextRunAt: now + nextRunMs
        })
      : updateItemStatus(current, "failed", {
          error,
          downloadId: undefined,
          downloadedFilename: undefined,
          downloadRequestedAt: undefined,
          nextRunAt: undefined
        });
  });
  if (retry) {
    scheduleRunnerWake(nextRunMs);
  }
  return retry;
}

async function patchQueueItem(itemId: string, patcher: (item: QueueItem) => QueueItem): Promise<void> {
  const queue = await loadQueue();
  await saveQueue(queue.map((item) => (item.id === itemId ? patcher(item) : item)));
}

async function scheduleItemResume(itemId: string, delayMs: number): Promise<void> {
  const nextRunAt = Date.now() + delayMs;
  await patchQueueItem(itemId, (current) => ({ ...current, nextRunAt }));
  scheduleRunnerWake(delayMs);
}

function isCheckpointWaiting(item: QueueItem): boolean {
  return item.nextRunAt !== undefined && item.nextRunAt > Date.now();
}

function isCheckpointTimedOut(item: QueueItem, timeoutMs: number): boolean {
  const startedAt = item.checkpointStartedAt ?? item.startedAt ?? item.createdAt;
  return Date.now() - startedAt >= timeoutMs;
}

function isDeferredResult(result: ContentAutomationResult | DeferredResult): result is DeferredResult {
  return "defer" in result;
}

function scheduleRunnerWake(delayMs: number): void {
  const boundedDelay = Math.max(0, Math.min(delayMs, CHECKPOINT_POLL_DELAY_MS));
  globalThis.setTimeout(() => {
    void resumeSavedQueueIfNeeded();
  }, boundedDelay);
}

function isRunnableQueueItem(item: QueueItem): boolean {
  const runnableStatuses: QueueStatus[] = [
    "pending",
    "paused",
    "running",
    "waiting_result",
    "downloading",
    "cooldown"
  ];
  return runnableStatuses.includes(item.status);
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

async function resumeSavedQueueIfNeeded(): Promise<void> {
  if (runnerActive) return;

  const [state, queue] = await Promise.all([loadRunnerState(), loadQueue()]);
  if (!shouldResumeRunner(state, queue)) {
    await updateRunnerWatchdogForState(state, queue);
    return;
  }

  await armRunnerWatchdog();
  void runQueue();
}

async function updateRunnerWatchdogForState(
  state?: RunnerState,
  queue?: QueueItem[]
): Promise<void> {
  const currentState = state ?? (await loadRunnerState());
  const currentQueue = queue ?? (await loadQueue());
  if (shouldKeepRunnerWatchdog(currentState, currentQueue)) {
    await armRunnerWatchdog();
    return;
  }

  await disarmRunnerWatchdog();
}

function shouldResumeRunner(state: RunnerState, queue: QueueItem[]): boolean {
  if (state.pauseRequested || state.status === "paused") return false;
  if (state.stopRequested || state.status === "stopping") return true;
  if (state.status === "running") return queue.some(isRunnableQueueItem);
  return queue.some((item) => item.status === "running" || item.status === "waiting_result" || item.status === "downloading");
}

function shouldKeepRunnerWatchdog(state: RunnerState, queue: QueueItem[]): boolean {
  if (state.pauseRequested || state.status === "paused") return false;
  if (state.stopRequested || state.status === "stopping") return true;
  return state.status === "running" && queue.some(isRunnableQueueItem);
}

async function armRunnerWatchdog(): Promise<void> {
  await chrome.alarms.create(RUNNER_ALARM_NAME, {
    delayInMinutes: RUNNER_ALARM_DELAY_MINUTES,
    periodInMinutes: RUNNER_ALARM_PERIOD_MINUTES
  });
}

async function disarmRunnerWatchdog(): Promise<void> {
  await chrome.alarms.clear(RUNNER_ALARM_NAME);
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
    await sleep(50);
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button: "left",
      buttons: 1,
      clickCount: 1
    });
    await sleep(50);
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
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
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
    if (isUsableFlowTab(tab)) return tab;
  } catch {
    // The stored tab was closed or Chrome no longer exposes it.
  }

  await saveTargetTab(null);
  return undefined;
}

async function captureActiveFlowTabTarget(): Promise<chrome.tabs.Tab | undefined> {
  const tab = await getActiveFlowTab();
  if (!tab || !isUsableFlowTab(tab)) return undefined;

  await saveFlowTargetTab(tab);
  return tab;
}

async function captureAnyFlowTabTarget(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({});
  const tab = tabs.find(isUsableFlowTab);
  if (!tab?.id) return undefined;

  await saveFlowTargetTab(tab);
  return tab;
}

async function saveFlowTargetTab(tab: chrome.tabs.Tab): Promise<void> {
  if (!tab.id) return;

  try {
    await chrome.tabs.update(tab.id, { autoDiscardable: false });
  } catch {
    // Some Chrome versions or managed profiles may reject this; the stored target still helps.
  }

  await saveTargetTab({
    tabId: tab.id,
    windowId: tab.windowId,
    url: tab.url,
    capturedAt: Date.now()
  });
}

function isUsableFlowTab(tab: chrome.tabs.Tab): boolean {
  return Boolean(tab.id && !tab.discarded && isRunnableFlowProjectUrl(tab.url));
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

function downloadWaitMs(settings: SceneFlowSettings): number {
  return Math.max(60_000, settings.maxWaitMinutesPerPrompt * 60 * 1000);
}

function isTemporaryFlowCommunicationError(error: string): boolean {
  return /communicate|receiving end|message port|context invalidated|frame was removed|no tab with id/i.test(error);
}
