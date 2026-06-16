import "./popup.css";
import { parseMarkdownPrompts } from "../core/parser/markdown-parser";
import { DEFAULT_SETTINGS } from "../core/config/defaults";
import { createQueueItems, loadQueue, loadRunnerState, loadSettings, saveQueue, saveSettings } from "../core/queue/queue-store";
import type { ExpectedExtension, QueueItem, SceneFlowSettings } from "../core/queue/queue-types";
import { sanitizeFolder } from "../core/utils/sanitize";

const fileInput = getElement<HTMLInputElement>("fileInput");
const outputFolderInput = getElement<HTMLInputElement>("outputFolderInput");
const cooldownInput = getElement<HTMLInputElement>("cooldownInput");
const maxWaitInput = getElement<HTMLInputElement>("maxWaitInput");
const retryInput = getElement<HTMLInputElement>("retryInput");
const extensionInput = getElement<HTMLSelectElement>("extensionInput");
const statusText = getElement<HTMLElement>("statusText");
const parseMessage = getElement<HTMLElement>("parseMessage");
const queueList = getElement<HTMLOListElement>("queueList");
const queueCount = getElement<HTMLElement>("queueCount");

getElement<HTMLButtonElement>("startButton").addEventListener("click", () => sendControl("QUEUE_START"));
getElement<HTMLButtonElement>("pauseButton").addEventListener("click", () => sendControl("QUEUE_PAUSE"));
getElement<HTMLButtonElement>("resumeButton").addEventListener("click", () => sendControl("QUEUE_RESUME"));
getElement<HTMLButtonElement>("stopButton").addEventListener("click", () => sendControl("QUEUE_STOP"));
getElement<HTMLButtonElement>("retryFailedButton").addEventListener("click", () => sendControl("QUEUE_RETRY_FAILED"));
getElement<HTMLButtonElement>("resetButton").addEventListener("click", () => sendControl("QUEUE_RESET"));
getElement<HTMLButtonElement>("refreshButton").addEventListener("click", renderState);
fileInput.addEventListener("change", handleFileUpload);

for (const input of [outputFolderInput, cooldownInput, maxWaitInput, retryInput, extensionInput]) {
  input.addEventListener("change", persistSettingsFromForm);
}

void init();

async function init(): Promise<void> {
  const settings = await loadSettings();
  writeSettings(settings);
  await renderState();
}

async function handleFileUpload(): Promise<void> {
  const file = fileInput.files?.[0];
  if (!file) return;

  if (!/\.(md|markdown|txt)$/i.test(file.name)) {
    showMessage("Choose a Markdown file with timestamp blocks.", true);
    return;
  }

  try {
    const settings = await persistSettingsFromForm();
    const markdown = await file.text();
    const result = parseMarkdownPrompts(markdown);
    const queue = createQueueItems(result.prompts, settings);
    await saveQueue(queue);
    showMessage(
      result.warnings.length > 0
        ? `Parsed ${queue.length} prompts with ${result.warnings.length} warning.`
        : `Parsed ${queue.length} prompts.`
    );
    await renderState();
  } catch (error) {
    showMessage(error instanceof Error ? error.message : "Could not parse the Markdown file.", true);
  }
}

async function persistSettingsFromForm(): Promise<SceneFlowSettings> {
  const settings: SceneFlowSettings = {
    outputFolder: sanitizeFolder(outputFolderInput.value || DEFAULT_SETTINGS.outputFolder),
    cooldownSeconds: clampNumber(cooldownInput.valueAsNumber, 0, 3600, DEFAULT_SETTINGS.cooldownSeconds),
    maxWaitMinutesPerPrompt: clampNumber(maxWaitInput.valueAsNumber, 1, 180, DEFAULT_SETTINGS.maxWaitMinutesPerPrompt),
    maxRetries: clampNumber(retryInput.valueAsNumber, 0, 10, DEFAULT_SETTINGS.maxRetries),
    expectedExtension: extensionInput.value as ExpectedExtension
  };

  writeSettings(settings);
  await saveSettings(settings);
  return settings;
}

async function sendControl(
  type: "QUEUE_START" | "QUEUE_PAUSE" | "QUEUE_RESUME" | "QUEUE_STOP" | "QUEUE_RESET" | "QUEUE_RETRY_FAILED"
): Promise<void> {
  await persistSettingsFromForm();
  await chrome.runtime.sendMessage({ type });
  await renderState();
}

async function renderState(): Promise<void> {
  const [queue, runnerState] = await Promise.all([loadQueue(), loadRunnerState()]);
  statusText.textContent = formatStatus(runnerState.status);
  queueCount.textContent = `${queue.length} ${queue.length === 1 ? "item" : "items"}`;
  renderQueue(queue);
}

function renderQueue(queue: QueueItem[]): void {
  queueList.replaceChildren(
    ...queue.map((item) => {
      const row = document.createElement("li");
      row.className = "queue-item";

      const index = document.createElement("span");
      index.className = "queue-index";
      index.textContent = String(item.index).padStart(3, "0");

      const title = document.createElement("div");
      title.className = "queue-title";
      const strong = document.createElement("strong");
      strong.textContent = item.title || item.timestamp;
      const detail = document.createElement("span");
      detail.textContent = item.error || item.targetFilename;
      if (item.error) detail.classList.add("is-error");
      title.append(strong, detail);

      const status = document.createElement("span");
      status.className = "queue-status";
      status.textContent = item.status;

      row.append(index, title, status);
      return row;
    })
  );
}

function writeSettings(settings: SceneFlowSettings): void {
  outputFolderInput.value = settings.outputFolder;
  cooldownInput.value = String(settings.cooldownSeconds);
  maxWaitInput.value = String(settings.maxWaitMinutesPerPrompt);
  retryInput.value = String(settings.maxRetries);
  extensionInput.value = settings.expectedExtension;
}

function showMessage(message: string, isError = false): void {
  parseMessage.textContent = message;
  parseMessage.classList.toggle("is-error", isError);
}

function formatStatus(status: string): string {
  return status.replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}
