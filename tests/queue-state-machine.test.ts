import { describe, expect, it } from "vitest";
import { createInitialRunnerState, getNextPendingItem, updateItemStatus } from "../src/core/queue/queue-state-machine";
import type { QueueItem } from "../src/core/queue/queue-types";

describe("queue state machine", () => {
  it("creates an idle runner state", () => {
    expect(createInitialRunnerState()).toMatchObject({
      status: "idle",
      pauseRequested: false,
      stopRequested: false
    });
  });

  it("sets timestamps when an item starts and completes", () => {
    const item = makeItem();
    const running = updateItemStatus(item, "running");
    const done = updateItemStatus(running, "done");

    expect(running.startedAt).toEqual(expect.any(Number));
    expect(done.startedAt).toBe(running.startedAt);
    expect(done.completedAt).toEqual(expect.any(Number));
  });

  it("finds pending or paused items", () => {
    const done = updateItemStatus(makeItem("done"), "done");
    const paused = updateItemStatus(makeItem("paused"), "paused");

    expect(getNextPendingItem([done, paused])?.id).toBe("paused");
  });
});

function makeItem(id = "item"): QueueItem {
  return {
    id,
    index: 1,
    timestamp: "00:00",
    safeTimestamp: "00-00",
    prompt: "Prompt",
    outputFolder: "google-flow-images",
    expectedExtension: "png",
    targetFilename: "google-flow-images/001_00-00.png",
    status: "pending",
    attempts: 0,
    maxRetries: 1,
    createdAt: 1
  };
}
