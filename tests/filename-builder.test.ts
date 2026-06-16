import { describe, expect, it } from "vitest";
import { buildQueueTargetFilename, buildTargetFilename } from "../src/core/download/filename-builder";

describe("filename builder", () => {
  it("builds indexed timestamp filenames with title", () => {
    expect(
      buildTargetFilename({
        index: 2,
        safeTimestamp: "00-04",
        safeTitle: "doorway_confusion",
        outputFolder: "google-flow-images",
        expectedExtension: "png"
      })
    ).toBe("google-flow-images/002_00-04_doorway_confusion.png");
  });

  it("omits missing titles", () => {
    expect(
      buildTargetFilename({
        index: 1,
        safeTimestamp: "00-00",
        outputFolder: "google-flow-images",
        expectedExtension: "webp"
      })
    ).toBe("google-flow-images/001_00-00.webp");
  });

  it("sanitizes folder, timestamp, and title inputs", () => {
    expect(
      buildQueueTargetFilename({
        index: 3,
        timestamp: "01:23",
        title: "Forgotten Name!",
        outputFolder: "Google Flow Images",
        expectedExtension: "jpg"
      })
    ).toBe("google_flow_images/003_01-23_forgotten_name.jpg");
  });
});
