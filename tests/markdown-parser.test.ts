import { describe, expect, it } from "vitest";
import { MarkdownParseError, parseMarkdownPrompts } from "../src/core/parser/markdown-parser";

describe("parseMarkdownPrompts", () => {
  it("parses basic timestamp blocks with titles", () => {
    const result = parseMarkdownPrompts(`
[00:00] lost_keys
A small stickman searches empty pockets.

[00:04] doorway_confusion
A stickman pauses in a doorway.
`);

    expect(result.prompts).toHaveLength(2);
    expect(result.prompts[0]).toMatchObject({
      index: 1,
      timestamp: "00:00",
      safeTimestamp: "00-00",
      title: "lost_keys",
      safeTitle: "lost_keys",
      prompt: "A small stickman searches empty pockets."
    });
  });

  it("keeps multiline prompt bodies unchanged after trimming block edges", () => {
    const result = parseMarkdownPrompts(`
[1:02:15] long_scene
First line.
Second line with style notes.
`);

    expect(result.prompts[0]?.timestamp).toBe("1:02:15");
    expect(result.prompts[0]?.prompt).toBe("First line.\nSecond line with style notes.");
  });

  it("warns on duplicate timestamps", () => {
    const result = parseMarkdownPrompts(`
[0:00]
First prompt.

[00:00]
Second prompt.
`);

    expect(result.warnings).toEqual([
      {
        code: "duplicate_timestamp",
        message: "Duplicate timestamp found: 00:00",
        timestamp: "00:00"
      }
    ]);
  });

  it("rejects empty files and files without timestamps", () => {
    expect(() => parseMarkdownPrompts("")).toThrow(MarkdownParseError);
    expect(() => parseMarkdownPrompts("Just a prompt")).toThrow("No timestamp blocks found");
  });

  it("rejects empty prompt bodies", () => {
    expect(() => parseMarkdownPrompts("[00:00]")).toThrow("Prompt body is empty");
    expect(() => parseMarkdownPrompts("[00:00] a")).toThrow("Prompt body is too short");
  });

  it("parses custom same-line timestamp syntax with brackets and millisecond/range format", () => {
    const result = parseMarkdownPrompts(`
[00 : 00 : 130 -> 00 : 01 : 110] You are lying in bed.
[00 : 01 : 390 -> 00 : 02 : 210] The room is dark;
`);

    expect(result.prompts).toHaveLength(2);
    expect(result.prompts[0]).toMatchObject({
      index: 1,
      timestamp: "00:00:130 -> 00:01:110",
      safeTimestamp: "00-00-130-00-01-110",
      prompt: "You are lying in bed.",
      title: undefined,
      safeTitle: undefined
    });
    expect(result.prompts[1]).toMatchObject({
      index: 2,
      timestamp: "00:01:390 -> 00:02:210",
      safeTimestamp: "00-01-390-00-02-210",
      prompt: "The room is dark;",
      title: undefined,
      safeTitle: undefined
    });
  });
});
