import type { SceneFlowSettings } from "../queue/queue-types";

export const DEFAULT_SETTINGS: SceneFlowSettings = {
  outputFolder: "google-flow-images",
  cooldownSeconds: 10,
  maxWaitMinutesPerPrompt: 15,
  maxRetries: 1,
  expectedExtension: "png"
};

export const STORAGE_KEYS = {
  settings: "sceneFlow.settings",
  queue: "sceneFlow.queue",
  currentItem: "sceneFlow.currentItem",
  targetTab: "sceneFlow.targetTab",
  runnerState: "sceneFlow.runnerState",
  lastRun: "sceneFlow.lastRun"
} as const;
