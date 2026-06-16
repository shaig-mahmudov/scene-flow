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

  const button = findGenerateButton();
  if (!button) return { ok: false, itemId: message.item.id, error: "Could not find the Generate button." };
  if (button.disabled) return { ok: false, itemId: message.item.id, error: "Generate button is disabled." };

  setPromptText(input, message.item.prompt);
  const initialResultCount = findResultCards().length;
  button.click();

  await waitForReadyResult({ initialResultCount, timeoutMs: message.maxWaitMs });
  return { ok: true, itemId: message.item.id };
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
