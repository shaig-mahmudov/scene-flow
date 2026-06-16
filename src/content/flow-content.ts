import { findGenerateButton, findPromptInput, findResultCards, setPromptText } from "./dom-selectors";
import { getReadyDownloadButton, waitForReadyResult } from "./result-watcher";
import type { ContentAutomationResult, ExtensionMessage } from "../core/messaging/messages";

let activeSubmission: { itemId: string; initialResultCount: number } | undefined;

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
  const button = await waitForGenerateButton(input);
  clickLikeUser(button);
  activeSubmission = { itemId: message.item.id, initialResultCount };

  return { ok: true, itemId: message.item.id };
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
  const button = getReadyDownloadButton(initialResultCount);
  return { ok: true, itemId: message.item.id, ready: Boolean(button) };
}

async function triggerDownload(
  message: Extract<ExtensionMessage, { type: "TRIGGER_DOWNLOAD" }>
): Promise<ContentAutomationResult> {
  const initialResultCount =
    activeSubmission?.itemId === message.item.id ? activeSubmission.initialResultCount : 0;
  const button =
    getReadyDownloadButton(initialResultCount) ??
    (await waitForReadyResult({ initialResultCount, timeoutMs: Math.min(message.maxWaitMs, 5000) }));
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

function toFailure(error: unknown, itemId?: string): ContentAutomationResult {
  return {
    ok: false,
    itemId,
    error: error instanceof Error ? error.message : "Unknown content script error."
  };
}
