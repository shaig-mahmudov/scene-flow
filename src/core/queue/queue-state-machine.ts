import type { QueueItem, QueueStatus, RunnerState } from "./queue-types";

export function createInitialRunnerState(status: RunnerState["status"] = "idle"): RunnerState {
  return {
    status,
    pauseRequested: false,
    stopRequested: false,
    updatedAt: Date.now()
  };
}

export function updateItemStatus(
  item: QueueItem,
  status: QueueStatus,
  patch: Partial<QueueItem> = {}
): QueueItem {
  const now = Date.now();
  const statusChanged = item.status !== status;
  return {
    ...item,
    ...patch,
    status,
    checkpointStartedAt: statusChanged
      ? (patch.checkpointStartedAt ?? now)
      : (patch.checkpointStartedAt ?? item.checkpointStartedAt),
    startedAt: status === "running" ? (item.startedAt ?? now) : (patch.startedAt ?? item.startedAt),
    completedAt:
      status === "done" || status === "failed" || status === "cancelled"
        ? (patch.completedAt ?? now)
        : (patch.completedAt ?? item.completedAt)
  };
}

export function getNextPendingItem(items: QueueItem[]): QueueItem | undefined {
  return items.find((item) => item.status === "pending" || item.status === "paused");
}

export function markPauseRequested(state: RunnerState): RunnerState {
  return {
    ...state,
    status: state.status === "running" ? "running" : "paused",
    pauseRequested: true,
    updatedAt: Date.now()
  };
}

export function markStopRequested(state: RunnerState): RunnerState {
  return {
    ...state,
    status: "stopping",
    stopRequested: true,
    updatedAt: Date.now()
  };
}
