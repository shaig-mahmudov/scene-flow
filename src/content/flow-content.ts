import {
  findDownloadButtonNearNewestMedia,
  findGenerateButton,
  findGeneratedMediaElements,
  findPromptInput,
  findResultCards,
  setPromptText
} from "./dom-selectors";
import { getResultReadiness, waitForReadyResult } from "./result-watcher";
import type { ContentAutomationResult, ExtensionMessage } from "../core/messaging/messages";

let activeSubmission:
  | { itemId: string; initialResultCount: number; initialMediaCount: number; submittedAt: number }
  | undefined;

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  if (message.type === "SUBMIT_PROMPT") {
    submitPrompt(message)
      .then(sendResponse)
      .catch((error: unknown) => sendResponse(toFailure(error, message.item.id)));
    return true;
  }

  if (message.type === "CHECK_RESULT_READY") {
    sendResponse(checkResultReady(message));
    return false;
  }

  if (message.type === "GET_DOWNLOAD_BUTTON") {
    sendResponse(getDownloadButton(message));
    return false;
  }

  if (message.type === "TRIGGER_DOWNLOAD") {
    triggerDownload(message)
      .then(sendResponse)
      .catch((error: unknown) => sendResponse(toFailure(error, message.item.id)));
    return true;
  }

  return false;
});

async function submitPrompt(message: Extract<ExtensionMessage, { type: "SUBMIT_PROMPT" }>): Promise<ContentAutomationResult> {
  closeOpenOverlay();
  const input = findPromptInput();
  if (!input) return { ok: false, itemId: message.item.id, error: "Could not find the Google Flow prompt input." };

  setPromptText(input, message.item.prompt);
  const initialResultCount = findResultCards().length;
  const initialMediaCount = findGeneratedMediaElements().length;
  const button = await waitForGenerateButton(input);
  activeSubmission = { itemId: message.item.id, initialResultCount, initialMediaCount, submittedAt: Date.now() };

  return { ok: true, itemId: message.item.id, clickPoint: getElementCenter(button) };
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

function checkResultReady(
  message: Extract<ExtensionMessage, { type: "CHECK_RESULT_READY" }>
): ContentAutomationResult {
  const initialResultCount =
    activeSubmission?.itemId === message.item.id ? activeSubmission.initialResultCount : 0;
  const initialMediaCount =
    activeSubmission?.itemId === message.item.id ? activeSubmission.initialMediaCount : 0;
  const submittedAt = activeSubmission?.itemId === message.item.id ? activeSubmission.submittedAt : Date.now();
  const readiness = getResultReadiness({ initialResultCount, initialMediaCount, submittedAt });
  return {
    ok: true,
    itemId: message.item.id,
    ready: readiness.ready,
    hasDownloadButton: readiness.hasDownloadButton,
    downloadClickPoint: readiness.downloadButton ? getElementCenter(readiness.downloadButton) : undefined,
    revealPoint: readiness.revealTarget ? getElementCenter(readiness.revealTarget) : undefined
  };
}

function getDownloadButton(
  message: Extract<ExtensionMessage, { type: "GET_DOWNLOAD_BUTTON" }>
): ContentAutomationResult {
  const button = findDownloadButtonNearNewestMedia();
  return {
    ok: true,
    itemId: message.item.id,
    ready: Boolean(button),
    hasDownloadButton: Boolean(button),
    downloadClickPoint: button ? getElementCenter(button) : undefined
  };
}

async function triggerDownload(
  message: Extract<ExtensionMessage, { type: "TRIGGER_DOWNLOAD" }>
): Promise<ContentAutomationResult> {
  const initialResultCount =
    activeSubmission?.itemId === message.item.id ? activeSubmission.initialResultCount : 0;
  const initialMediaCount =
    activeSubmission?.itemId === message.item.id ? activeSubmission.initialMediaCount : 0;
  const submittedAt = activeSubmission?.itemId === message.item.id ? activeSubmission.submittedAt : Date.now();
  const readiness = getResultReadiness({ initialResultCount, initialMediaCount, submittedAt });
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

function getElementCenter(element: HTMLElement): { x: number; y: number } {
  const rect = element.getBoundingClientRect();
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
