import type { QueueItem, RunnerState, SceneFlowSettings } from "../queue/queue-types";

export type ContentAutomationResult =
  | {
      ok: true;
      itemId: string;
      ready?: boolean;
      hasDownloadButton?: boolean;
      clickPoint?: ViewportClickPoint;
      revealPoint?: ViewportClickPoint;
      downloadClickPoint?: ViewportClickPoint;
    }
  | { ok: false; itemId?: string; error: string };

export type ViewportClickPoint = {
  x: number;
  y: number;
};

export type ExtensionMessage =
  | { type: "QUEUE_LOAD"; items: QueueItem[] }
  | { type: "QUEUE_START" }
  | { type: "QUEUE_PAUSE" }
  | { type: "QUEUE_RESUME" }
  | { type: "QUEUE_STOP" }
  | { type: "QUEUE_RESET" }
  | { type: "QUEUE_RETRY_FAILED" }
  | { type: "QUEUE_STATE"; items: QueueItem[]; runnerState: RunnerState; settings: SceneFlowSettings }
  | { type: "SUBMIT_PROMPT"; item: QueueItem; maxWaitMs: number }
  | { type: "CHECK_RESULT_READY"; item: QueueItem }
  | { type: "GET_DOWNLOAD_BUTTON"; item: QueueItem }
  | { type: "TRIGGER_DOWNLOAD"; item: QueueItem; maxWaitMs: number }
  | { type: "PROMPT_SUBMITTED"; itemId: string }
  | { type: "RESULT_READY"; itemId: string }
  | { type: "DOWNLOAD_TRIGGERED"; itemId: string }
  | { type: "ITEM_DONE"; itemId: string }
  | { type: "ITEM_FAILED"; itemId: string; error: string };

export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  return typeof value === "object" && value !== null && "type" in value;
}
