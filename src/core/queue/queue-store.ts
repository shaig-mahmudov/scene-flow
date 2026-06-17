import { DEFAULT_SETTINGS, STORAGE_KEYS } from "../config/defaults";
import { buildQueueTargetFilename } from "../download/filename-builder";
import type { FlowTargetTab, ParsedPrompt, QueueItem, RunnerState, SceneFlowSettings } from "./queue-types";
import { createInitialRunnerState } from "./queue-state-machine";

type StorageShape = {
  [STORAGE_KEYS.settings]?: SceneFlowSettings;
  [STORAGE_KEYS.queue]?: QueueItem[];
  [STORAGE_KEYS.currentItem]?: QueueItem | null;
  [STORAGE_KEYS.targetTab]?: FlowTargetTab | null;
  [STORAGE_KEYS.runnerState]?: RunnerState;
};

export async function loadSettings(): Promise<SceneFlowSettings> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.settings);
  return { ...DEFAULT_SETTINGS, ...(stored[STORAGE_KEYS.settings] as Partial<SceneFlowSettings> | undefined) };
}

export async function saveSettings(settings: SceneFlowSettings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: settings });
}

export async function loadQueue(): Promise<QueueItem[]> {
  const stored = (await chrome.storage.local.get(STORAGE_KEYS.queue)) as StorageShape;
  return stored[STORAGE_KEYS.queue] ?? [];
}

export async function saveQueue(queue: QueueItem[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.queue]: queue });
}

export async function loadRunnerState(): Promise<RunnerState> {
  const stored = (await chrome.storage.local.get(STORAGE_KEYS.runnerState)) as StorageShape;
  return stored[STORAGE_KEYS.runnerState] ?? createInitialRunnerState();
}

export async function saveRunnerState(state: RunnerState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.runnerState]: state });
}

export async function setCurrentItem(item: QueueItem | null): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.currentItem]: item });
}

export async function loadCurrentItem(): Promise<QueueItem | null> {
  const stored = (await chrome.storage.local.get(STORAGE_KEYS.currentItem)) as StorageShape;
  return stored[STORAGE_KEYS.currentItem] ?? null;
}

export async function saveTargetTab(targetTab: FlowTargetTab | null): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.targetTab]: targetTab });
}

export async function loadTargetTab(): Promise<FlowTargetTab | null> {
  const stored = (await chrome.storage.local.get(STORAGE_KEYS.targetTab)) as StorageShape;
  return stored[STORAGE_KEYS.targetTab] ?? null;
}

export function createQueueItems(
  prompts: ParsedPrompt[],
  settings: SceneFlowSettings,
  now = Date.now()
): QueueItem[] {
  return prompts.map((prompt) => {
    const itemBase = {
      id: `${prompt.index}-${prompt.safeTimestamp}-${crypto.randomUUID()}`,
      index: prompt.index,
      timestamp: prompt.timestamp,
      safeTimestamp: prompt.safeTimestamp,
      title: prompt.title,
      safeTitle: prompt.safeTitle,
      prompt: prompt.prompt,
      outputFolder: settings.outputFolder,
      expectedExtension: settings.expectedExtension,
      status: "pending" as const,
      attempts: 0,
      maxRetries: settings.maxRetries,
      createdAt: now
    };

    return {
      ...itemBase,
      targetFilename: buildQueueTargetFilename(itemBase)
    };
  });
}
