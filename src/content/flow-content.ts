import { findGenerateButton, findPromptInput, findResultCards, setPromptText } from "./dom-selectors";
import { waitForReadyResult } from "./result-watcher";
import type { ContentAutomationResult, ExtensionMessage } from "../core/messaging/messages";

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  if (message.type === "SUBMIT_PROMPT") {
    submitPrompt(message)
      .then(sendResponse)
      .catch((error: unknown) => sendResponse(toFailure(error, message.item.id)));
    return true;
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
  const input = findPromptInput();
  if (!input) return { ok: false, itemId: message.item.id, error: "Could not find the Google Flow prompt input." };

  setPromptText(input, message.item.prompt);
  const initialResultCount = findResultCards().length;
  const button = await waitForGenerateButton(input);
  button.click();

  await waitForReadyResult({ initialResultCount, timeoutMs: message.maxWaitMs });
  return { ok: true, itemId: message.item.id };
}

async function waitForGenerateButton(input: HTMLElement): Promise<HTMLButtonElement> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 3000) {
    const button = findGenerateButton(input);
    if (button && !button.disabled && button.getAttribute("aria-disabled") !== "true") {
      return button;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }

  const button = findGenerateButton(input);
  if (!button) throw new Error("Could not find the Generate button.");
  throw new Error("Generate button is disabled after setting the prompt.");
}

async function triggerDownload(
  message: Extract<ExtensionMessage, { type: "TRIGGER_DOWNLOAD" }>
): Promise<ContentAutomationResult> {
  const button = await waitForReadyResult({ initialResultCount: 0, timeoutMs: message.maxWaitMs });
  button.click();
  return { ok: true, itemId: message.item.id };
}

function toFailure(error: unknown, itemId?: string): ContentAutomationResult {
  return {
    ok: false,
    itemId,
    error: error instanceof Error ? error.message : "Unknown content script error."
  };
}
