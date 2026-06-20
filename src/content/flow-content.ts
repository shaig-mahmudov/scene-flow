import {
  findDownloadButtonNearNewestMedia,
  findGenerateButton,
  findGeneratedMediaElements,
  findNewestGeneratedMediaSource,
  findOverflowMenuButtonNearNewestMedia,
  findOriginalSizeDownloadOption,
  findPromptInput,
  findResultCards,
  setPromptText
} from "./dom-selectors";
import { getResultReadiness, waitForReadyResult } from "./result-watcher";
import type { ContentAutomationResult, ExtensionMessage } from "../core/messaging/messages";

let activeSubmission:
  | { itemId: string; initialResultCount: number; initialMediaCount: number; initialMediaSource?: string; submittedAt: number }
  | undefined;

let lastTargetedElement: HTMLElement | null = null;

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  if (message.type === "SUBMIT_PROMPT") {
    submitPrompt(message)
      .then(sendResponse)
      .catch((error: unknown) => sendResponse(toFailure(error, message.item.id)));
    return true;
  }

  if (message.type === "CHECK_RESULT_READY") {
    checkResultReady(message)
      .then(sendResponse)
      .catch((error: unknown) => sendResponse(toFailure(error, message.item.id)));
    return true;
  }

  if (message.type === "GET_DOWNLOAD_BUTTON") {
    getDownloadButton(message)
      .then(sendResponse)
      .catch((error: unknown) => sendResponse(toFailure(error, message.item.id)));
    return true;
  }

  if (message.type === "GET_DOWNLOAD_SIZE_OPTION") {
    getDownloadSizeOption(message)
      .then(sendResponse)
      .catch((error: unknown) => sendResponse(toFailure(error, message.item.id)));
    return true;
  }

  if (message.type === "GET_NEWEST_MEDIA_SOURCE") {
    sendResponse(getNewestMediaSource(message));
    return false;
  }

  if (message.type === "TRIGGER_DOWNLOAD") {
    triggerDownload(message)
      .then(sendResponse)
      .catch((error: unknown) => sendResponse(toFailure(error, message.item.id)));
    return true;
  }

  if (message.type === "REFRESH_COORDINATES") {
    refreshCoordinates()
      .then(sendResponse)
      .catch((error: unknown) => sendResponse(toFailure(error)));
    return true;
  }

  return false;
});

async function submitPrompt(message: Extract<ExtensionMessage, { type: "SUBMIT_PROMPT" }>): Promise<ContentAutomationResult> {
  closeOpenOverlay();
  const input = findPromptInput();
  if (!input) return { ok: false, itemId: message.item.id, error: "Could not find the Google Flow prompt input." };

  setPromptText(input, message.item.prompt);
  closeOpenOverlay(); // Clear any popups or tooltips that appeared after typing
  const initialResultCount = findResultCards().length;
  const initialMediaCount = findGeneratedMediaElements().length;
  const initialMediaSource = findNewestGeneratedMediaSource();
  const button = await waitForGenerateButton(input);
  
  const submittedAt = Date.now();
  activeSubmission = { itemId: message.item.id, initialResultCount, initialMediaCount, initialMediaSource, submittedAt };
  lastTargetedElement = button;

  let clickPoint: { x: number; y: number } | undefined;
  try {
    clickPoint = await getElementCenterAsync(button);
    showVisualIndicator(clickPoint.x, clickPoint.y);
  } catch (error) {
    console.warn("Could not calculate click point coordinates:", error);
  }

  // Attempt DOM click (hybrid click mechanism)
  let domClickSucceeded = false;
  try {
    console.log("Attempting direct DOM click on button...");
    clickLikeUser(button);
    
    // Wait 250ms to see if page state reacted/submitted
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    
    const isDisabledOrGone = !button.isConnected || button.getAttribute("aria-disabled") === "true" || button.hasAttribute("disabled");
    const currentInputVal = (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) ? input.value : input.textContent;
    if (isDisabledOrGone || !currentInputVal || currentInputVal.trim() === "") {
      console.log("Direct DOM click succeeded (button disabled/gone or input cleared). Bypassing hardware click.");
      domClickSucceeded = true;
    } else {
      console.log("Input still has content. Direct DOM click might not have submitted the form.");
    }
  } catch (e) {
    console.error("Direct DOM click error:", e);
  }

  return {
    ok: true,
    itemId: message.item.id,
    clickPoint,
    submittedAt,
    initialResultCount,
    initialMediaCount,
    initialMediaSource,
    domClickSucceeded
  };
}

async function waitForGenerateButton(input: HTMLElement): Promise<HTMLElement> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 3000) {
    const button = findGenerateButton(input);
    if (button && button.getAttribute("aria-disabled") !== "true") {
      return button;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }

  const button = findGenerateButton(input);
  if (!button) throw new Error("Could not find the Generate button.");
  throw new Error("Could not find an enabled composer send button after setting the prompt.");
}

async function checkResultReady(
  message: Extract<ExtensionMessage, { type: "CHECK_RESULT_READY" }>
): Promise<ContentAutomationResult> {
  const initialResultCount =
    message.item.initialResultCount ??
    (activeSubmission?.itemId === message.item.id ? activeSubmission.initialResultCount : 0);
  const initialMediaCount =
    message.item.initialMediaCount ??
    (activeSubmission?.itemId === message.item.id ? activeSubmission.initialMediaCount : 0);
  const initialMediaSource =
    message.item.initialMediaSource ??
    (activeSubmission?.itemId === message.item.id ? activeSubmission.initialMediaSource : undefined);
  const submittedAt =
    message.item.submittedAt ??
    (activeSubmission?.itemId === message.item.id ? activeSubmission.submittedAt : Date.now());
  const readiness = getResultReadiness({ initialResultCount, initialMediaCount, initialMediaSource, submittedAt });
  lastTargetedElement = readiness.downloadButton ?? readiness.revealTarget ?? null;
  return {
    ok: true,
    itemId: message.item.id,
    ready: readiness.ready,
    hasDownloadButton: readiness.hasDownloadButton,
    downloadClickPoint: readiness.downloadButton ? await getElementCenterAsync(readiness.downloadButton) : undefined,
    revealPoint: readiness.revealTarget ? await getElementCenterAsync(readiness.revealTarget) : undefined,
    submittedAt,
    initialResultCount,
    initialMediaCount,
    initialMediaSource
  };
}

async function getDownloadButton(
  message: Extract<ExtensionMessage, { type: "GET_DOWNLOAD_BUTTON" }>
): Promise<ContentAutomationResult> {
  const button = findDownloadButtonNearNewestMedia();
  const menuButton = button ? null : findOverflowMenuButtonNearNewestMedia();
  lastTargetedElement = button ?? menuButton ?? null;
  return {
    ok: true,
    itemId: message.item.id,
    ready: Boolean(button),
    hasDownloadButton: Boolean(button),
    downloadClickPoint: button ? await getElementCenterAsync(button) : undefined,
    menuClickPoint: menuButton ? await getElementCenterAsync(menuButton) : undefined
  };
}

async function getDownloadSizeOption(
  message: Extract<ExtensionMessage, { type: "GET_DOWNLOAD_SIZE_OPTION" }>
): Promise<ContentAutomationResult> {
  const option = findOriginalSizeDownloadOption();
  lastTargetedElement = option;
  return {
    ok: true,
    itemId: message.item.id,
    ready: Boolean(option),
    sizeClickPoint: option ? await getElementCenterAsync(option) : undefined
  };
}

function getNewestMediaSource(
  message: Extract<ExtensionMessage, { type: "GET_NEWEST_MEDIA_SOURCE" }>
): ContentAutomationResult {
  return {
    ok: true,
    itemId: message.item.id,
    ready: true,
    mediaUrl: findNewestGeneratedMediaSource()
  };
}

async function triggerDownload(
  message: Extract<ExtensionMessage, { type: "TRIGGER_DOWNLOAD" }>
): Promise<ContentAutomationResult> {
  const initialResultCount =
    message.item.initialResultCount ??
    (activeSubmission?.itemId === message.item.id ? activeSubmission.initialResultCount : 0);
  const initialMediaCount =
    message.item.initialMediaCount ??
    (activeSubmission?.itemId === message.item.id ? activeSubmission.initialMediaCount : 0);
  const initialMediaSource =
    message.item.initialMediaSource ??
    (activeSubmission?.itemId === message.item.id ? activeSubmission.initialMediaSource : undefined);
  const submittedAt =
    message.item.submittedAt ??
    (activeSubmission?.itemId === message.item.id ? activeSubmission.submittedAt : Date.now());
  const readiness = getResultReadiness({ initialResultCount, initialMediaCount, initialMediaSource, submittedAt });
  if (!readiness.hasDownloadButton) {
    const button = findDownloadButtonNearNewestMedia();
    if (!button) return { ok: false, itemId: message.item.id, error: "Could not find a Flow download button." };
    clickLikeUser(button);
    return { ok: true, itemId: message.item.id };
  }

  const button =
    readiness.downloadButton ??
    (await waitForReadyResult({
      initialResultCount,
      initialMediaCount,
      submittedAt,
      timeoutMs: Math.min(message.maxWaitMs, 5000)
    }));
  clickLikeUser(button);
  return { ok: true, itemId: message.item.id };
}

function closeOpenOverlay(): void {
  document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape", code: "Escape" }));
  document.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Escape", code: "Escape" }));
}


function clickLikeUser(button: HTMLElement): void {
  button.scrollIntoView({ block: "center", inline: "center" });
  button.focus();

  for (const type of ["pointerover", "pointerenter", "pointermove", "pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    button.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        button: 0,
        buttons: type.endsWith("down") ? 1 : 0
      })
    );
  }

  button.click();
}

async function getElementCenterAsync(element: HTMLElement): Promise<{ x: number; y: number }> {
  element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  
  const rect = element.getBoundingClientRect();
  
  if (rect.width === 0 || rect.height === 0) {
    throw new Error("Chrome window appears to be minimized or fully hidden by the OS. Cannot capture coordinates.");
  }

  return {
    x: Math.round(rect.left + rect.width / 2),
    y: Math.round(rect.top + rect.height / 2)
  };
}

function toFailure(error: unknown, itemId?: string): ContentAutomationResult {
  return {
    ok: false,
    itemId,
    error: error instanceof Error ? error.message : "Unknown content script error."
  };
}

function showVisualIndicator(x: number, y: number): void {
  const existing = document.getElementById("scene-flow-debug-indicator");
  if (existing) {
    existing.remove();
  }
  const dot = document.createElement("div");
  dot.id = "scene-flow-debug-indicator";
  dot.style.position = "fixed";
  dot.style.left = `${x - 6}px`;
  dot.style.top = `${y - 6}px`;
  dot.style.width = "12px";
  dot.style.height = "12px";
  dot.style.borderRadius = "50%";
  dot.style.backgroundColor = "#ff003c";
  dot.style.border = "2px solid #ffffff";
  dot.style.boxShadow = "0 0 8px rgba(255, 0, 60, 0.8)";
  dot.style.zIndex = "2147483647";
  dot.style.pointerEvents = "none";
  document.body.appendChild(dot);
  console.log(`[Scene Flow Debug] Injected visual indicator dot at viewport coordinate: (${x}, ${y})`);
}

async function refreshCoordinates(): Promise<ContentAutomationResult> {
  if (!lastTargetedElement || !lastTargetedElement.isConnected) {
    return { ok: false, error: "Target element is no longer in the DOM. Layout shift may have caused it to unmount." };
  }
  const clickPoint = await getElementCenterAsync(lastTargetedElement);
  showVisualIndicator(clickPoint.x, clickPoint.y);
  return { ok: true, itemId: "", clickPoint };
}
