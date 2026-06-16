import { describe, expect, it } from "vitest";
import { isSupportedFlowUrl } from "../src/core/config/supported-flow";

describe("isSupportedFlowUrl", () => {
  it("allows the current Labs Google Flow URL", () => {
    expect(
      isSupportedFlowUrl("https://labs.google/fx/tools/flow/project/9bd44fb1-bdd9-4fdd-a401-48d3b6a7cc01")
    ).toBe(true);
  });

  it("allows the original Flow URL", () => {
    expect(isSupportedFlowUrl("https://flow.google.com/project/example")).toBe(true);
  });

  it("rejects unrelated Labs pages", () => {
    expect(isSupportedFlowUrl("https://labs.google/other/tool")).toBe(false);
  });
});
