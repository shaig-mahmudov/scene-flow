# IMPLEMENTATION_PLAN

# Scene Flow — Chrome Extension Implementation Plan

## 1. Project Decision

### Extension Display Name

**Scene Flow**

This is the user-facing extension name shown in Chrome.

### Recommended Repository Name

**`scene-flow`**

Reason:

- Clean and professional.
- Short enough for GitHub and package naming.
- Not locked only to “extension” if the project later grows into a desktop helper, CLI, or browser-independent workflow tool.
- Avoids using “Google Flow” as the product/repo name, which is better for branding and trademark safety.

Alternative if the name is already taken:

- `scene-flow-extension`
- `scene-flow-helper`
- `scene-flow-queue`

Recommended final choice:

```text
repo: scene-flow
extension name: Scene Flow
```

---

## 2. Product Goal

Scene Flow is a private, local-first Chrome extension for timestamp-based scene prompt automation.

The extension allows the user to upload a Markdown file containing timestamped prompts, converts those prompts into a queue, submits them one by one to Google Flow, waits for each result to finish, downloads the result into a dedicated Downloads subfolder, names the downloaded file using the timestamp, waits for a configurable cooldown period, and then continues with the next prompt.

The goal is not to spam or mass-submit prompts aggressively. The goal is to automate a repetitive manual workflow in a controlled, privacy-friendly, serial queue.

---

## 3. Core Workflow

```text
1. User prepares a .md file with timestamped prompts.
2. User opens Google Flow in Chrome.
3. User opens Scene Flow extension popup.
4. User uploads the .md file.
5. Extension parses timestamps and prompts.
6. Extension creates a local queue.
7. User clicks Start.
8. Extension submits the first prompt.
9. Extension waits until the result is ready.
10. Extension triggers the normal Google Flow download button.
11. Background script renames the download using the current queue item.
12. File is saved into Downloads/google-flow-images/.
13. Extension marks item as done.
14. Extension waits 10 seconds by default.
15. Extension moves to the next prompt.
16. Process repeats until queue is completed, paused, stopped, or failed.
```

---

## 4. MVP Scope

The first version should focus only on the essential workflow.

### Included in MVP

- Markdown file upload.
- Timestamp-based prompt parsing.
- Queue creation.
- Queue status display.
- Manual Start, Pause, Resume, Stop.
- One prompt at a time.
- Wait until current result is ready before submitting the next prompt.
- Configurable cooldown after each completed download.
- Default cooldown: `10 seconds`.
- Download Variant A:
  - Click the existing Google Flow download button.
  - Override the filename using `chrome.downloads.onDeterminingFilename`.
- Save downloads under:

```text
Downloads/google-flow-images/
```

- Filename based on:
  - queue index
  - timestamp
  - optional scene title
- Local-only storage using `chrome.storage.local`.
- No external server.
- No analytics.
- No cookies/session access.
- No auto-login.
- No parallel generation.

### Not Included in MVP

- Download Variant B.
- Remote API calls.
- Cloud sync.
- Account switching.
- Multi-tab generation.
- Parallel queue execution.
- Auto-login.
- Browser history access.
- Cookie access.
- Clipboard reading.
- Full Chrome Web Store publishing.

---

## 5. Markdown Prompt Format

### Recommended Format

```md
[00:00] lost_keys
A small minimalist stickman searches empty pockets for lost keys.
Simple 2D line-art, clean background, quiet visual comedy, no text.

[00:04] doorway_confusion
A stickman pauses in a doorway, confused, forgetting why they entered.
Minimal scene, soft shadows, simple expressive pose, no text.

[00:08] forgotten_name
A handshake scene where someone's name fades into floating abstract shapes.
Simple stickman characters, clean composition, no readable text.
```

### Timestamp Rules

Supported timestamp examples:

```text
[00:00]
[0:00]
[01:23]
[1:02:15]
```

Preferred format:

```text
[MM:SS]
```

For longer videos:

```text
[HH:MM:SS]
```

### Prompt Block Rules

Each timestamp starts a new prompt block.

The optional text after the timestamp becomes the scene title:

```md
[00:04] doorway_confusion
```

In this case:

```text
timestamp: 00:04
title: doorway_confusion
prompt: all text until the next timestamp
```

### Why This Format

This format is stable because:

- It is easy to write manually.
- It is easy to parse reliably.
- The timestamp becomes the scene ID.
- The title becomes a readable filename suffix.
- Prompt body can still contain paragraphs, commas, style notes, and normal Markdown text.

---

## 6. Output Folder and Filename Strategy

### Download Folder

All downloaded files should be saved inside:

```text
Downloads/google-flow-images/
```

Chrome extensions cannot freely write to arbitrary absolute paths like:

```text
C:/Users/Shaig/Desktop/custom-folder
D:/Projects/output
```

But they can suggest a relative filename path inside the browser's default Downloads directory.

### Filename Format

Recommended format:

```text
google-flow-images/{index}_{safeTimestamp}_{safeTitle}.{ext}
```

Example:

```text
google-flow-images/001_00-00_lost_keys.png
google-flow-images/002_00-04_doorway_confusion.png
google-flow-images/003_00-08_forgotten_name.png
```

If title is missing:

```text
google-flow-images/001_00-00.png
google-flow-images/002_00-04.png
```

### Why Include Index

Using an index is useful because:

- File sorting stays stable.
- Duplicate timestamps do not fully break ordering.
- Editing software imports files in the correct order more reliably.
- It is easier to visually scan a folder.

### Timestamp Sanitization

File systems do not always handle `:` safely in filenames, so timestamps should be converted:

```text
00:04 -> 00-04
01:23 -> 01-23
1:02:15 -> 1-02-15
```

### Title Sanitization

Scene titles should be converted to lowercase safe slugs:

```text
doorway confusion -> doorway_confusion
Forgotten Name! -> forgotten_name
```

Allowed filename characters:

```text
a-z
0-9
_
-
```

---

## 7. Technology Stack

### Recommended Stack

```text
Language: TypeScript
Extension Platform: Chrome Extension Manifest V3
Build Tool: Vite
UI: Plain HTML + CSS + TypeScript
Testing: Vitest
Linting: ESLint
Formatting: Prettier
Storage: chrome.storage.local
Download Handling: chrome.downloads API
Automation Layer: Content Script + DOM selectors
```

### Why TypeScript

TypeScript is recommended because:

- Extension code has many message contracts.
- Queue state needs clear types.
- Parser logic benefits from typed objects.
- Background/content/popup communication becomes safer.
- Future refactoring is easier.

### Why Plain HTML/CSS Instead of React

For MVP, React is not necessary.

Plain UI is better because:

- Smaller build.
- Less complexity.
- Faster to debug.
- Enough for a popup with upload, queue list, and buttons.

React can be added later if the UI grows.

### Why Manifest V3

Chrome Extension Manifest V3 is the current Chrome extension platform model. It uses a service worker for background logic and is the right target for a new Chrome extension.

---

## 8. High-Level Architecture

```text
scene-flow/
  public/
    icons/
      icon-16.png
      icon-32.png
      icon-48.png
      icon-128.png

  src/
    background/
      service-worker.ts
      download-router.ts

    content/
      flow-content.ts
      dom-selectors.ts
      result-watcher.ts

    popup/
      popup.html
      popup.ts
      popup.css

    core/
      parser/
        markdown-parser.ts
        timestamp.ts

      queue/
        queue-types.ts
        queue-store.ts
        queue-runner.ts
        queue-state-machine.ts

      download/
        filename-builder.ts

      messaging/
        messages.ts

      config/
        defaults.ts

      utils/
        sleep.ts
        sanitize.ts
        logger.ts

  tests/
    markdown-parser.test.ts
    filename-builder.test.ts
    queue-state-machine.test.ts

  manifest.json
  package.json
  vite.config.ts
  tsconfig.json
  README.md
  IMPLEMENTATION_PLAN.md
```

---

## 9. Main Extension Parts

### 9.1 Popup

The popup is the control center.

Responsibilities:

- Upload `.md` file.
- Parse file.
- Show queue preview.
- Show current status.
- Allow Start, Pause, Resume, Stop.
- Allow settings:
  - cooldown seconds
  - max wait per prompt
  - retry count
  - output folder name
  - filename template
- Save/load state from `chrome.storage.local`.

Minimal popup layout:

```text
Scene Flow

[Upload .md File]

Output folder:
[google-flow-images]

Cooldown after each item:
[10] seconds

Max wait per prompt:
[15] minutes

Retry failed prompt:
[1] time

[Start] [Pause] [Resume] [Stop]

Queue:
001 00:00 lost_keys              pending
002 00:04 doorway_confusion      running
003 00:08 forgotten_name         pending
```

---

### 9.2 Content Script

The content script runs inside the Google Flow page.

Responsibilities:

- Check that the current page is supported.
- Find prompt input.
- Set prompt text into the input.
- Dispatch proper input/change events.
- Find and click the Generate button.
- Watch the page for result completion.
- Find and click the Download button for the newly generated result.
- Report status back to background/popup.

Important principle:

```text
The content script should only automate the visible active page.
It should not access account tokens, cookies, or private browser data.
```

---

### 9.3 Background Service Worker

The background service worker coordinates browser-level actions.

Responsibilities:

- Keep current queue item context for download naming.
- Listen to `chrome.downloads.onDeterminingFilename`.
- Suggest the final filename under `google-flow-images/`.
- Handle messages from popup/content script.
- Persist queue state when needed.

Important:

The background service worker in Manifest V3 is not a permanently running process. State should be saved to `chrome.storage.local`, not only kept in memory.

---

### 9.4 Core Queue Runner

The queue runner controls the serial workflow.

Responsibilities:

- Pick next pending item.
- Mark item as running.
- Send prompt to content script.
- Wait for completion.
- Prepare filename context.
- Trigger download through content script.
- Wait for download event.
- Mark item as done.
- Wait cooldown.
- Continue to next item.
- Stop safely on pause/stop/error.

---

## 10. Queue Item Data Model

```ts
export type QueueStatus =
  | "pending"
  | "running"
  | "waiting_result"
  | "downloading"
  | "cooldown"
  | "done"
  | "failed"
  | "paused"
  | "cancelled";

export type QueueItem = {
  id: string;
  index: number;

  timestamp: string;
  safeTimestamp: string;

  title?: string;
  safeTitle?: string;

  prompt: string;

  outputFolder: string;
  expectedExtension: "png" | "jpg" | "webp" | "mp4";
  targetFilename: string;

  status: QueueStatus;

  attempts: number;
  maxRetries: number;

  createdAt: number;
  startedAt?: number;
  completedAt?: number;

  error?: string;
};
```

---

## 11. Queue State Machine

```text
IDLE
  |
  v
QUEUE_READY
  |
  v
RUNNING_ITEM
  |
  v
SUBMITTING_PROMPT
  |
  v
WAITING_RESULT
  |
  v
DOWNLOADING
  |
  v
COOLDOWN
  |
  v
NEXT_ITEM
  |
  v
COMPLETED
```

### Pause Flow

```text
RUNNING_ITEM -> pause requested
Current item is allowed to finish safely.
No new item starts after current step.
State becomes PAUSED.
```

### Stop Flow

```text
STOP requested
No new item starts.
Current automation attempt is cancelled if safe.
Queue state becomes CANCELLED or IDLE.
```

### Failure Flow

```text
Prompt fails
  |
  v
Retry if attempts <= maxRetries
  |
  v
If still fails, mark failed
  |
  v
Move to next pending item
```

---

## 12. Completion Detection Logic

The hardest part of the extension is not submitting prompts. The hardest part is detecting when a generated result is actually ready.

Recommended MVP strategy:

```text
A result is considered ready when:
1. A new result/card appears after prompt submission.
2. Loading indicator for that card disappears.
3. A download/action button becomes visible and clickable.
```

Implementation approach:

- Capture the number of existing result cards before submission.
- Submit prompt.
- Use `MutationObserver` to watch page changes.
- Wait until a new card appears.
- Find a download button inside or near the newest card.
- Confirm button is enabled/clickable.
- Trigger download.
- If no result appears before timeout, mark item as failed.

Timeout default:

```text
15 minutes per prompt
```

Retry default:

```text
1 retry
```

---

## 13. Download Strategy

### MVP: Variant A

Use the existing Google Flow download button.

Flow:

```text
1. Queue runner sets currentQueueItem in storage/background context.
2. Content script clicks Google Flow's download button.
3. Chrome starts a download.
4. Background service worker receives onDeterminingFilename.
5. Extension suggests the target filename:
   google-flow-images/001_00-00_lost_keys.png
6. Chrome saves the file inside Downloads/google-flow-images/.
```

### Why Variant A First

Variant A is better for MVP because:

- It follows the website's normal download behavior.
- No need to extract internal media URLs.
- Less brittle than reverse-engineering download links.
- Easier to implement and test.
- Privacy-friendly because the file is downloaded through the user's active browser session.

### Future: Variant B

Variant B can be tested later.

Variant B idea:

```text
1. Detect or extract result media URL.
2. Call chrome.downloads.download({ url, filename }).
3. Download directly with controlled filename.
```

This may be cleaner long-term, but it depends on whether Google Flow exposes a usable media URL in the DOM.

---

## 14. Permissions Strategy

### MVP Permissions

```json
{
  "permissions": ["storage", "activeTab", "downloads", "scripting"],
  "host_permissions": ["https://flow.google.com/*"]
}
```

### Permission Purpose

| Permission | Purpose |
|---|---|
| `storage` | Save queue, settings, current item, progress |
| `activeTab` | Allow action on the currently active tab after user interaction |
| `downloads` | Rename downloads and place them inside subfolder |
| `scripting` | Inject/execute content script when needed |
| `host_permissions` | Restrict automation to Google Flow only |

### Permissions to Avoid

Do not request:

```text
<all_urls>
cookies
history
bookmarks
webRequest
clipboardRead
clipboardWrite
tabs unless truly needed
nativeMessaging
management
debugger
```

Reason:

- These are unnecessary for the MVP.
- They increase privacy risk.
- They make the extension look suspicious.
- They may create scary permission warnings.

---

## 15. Privacy and Security Rules

Scene Flow should be local-first.

### Rules

- No external API calls.
- No analytics.
- No telemetry.
- No prompt upload to any server.
- No account/session/cookie access.
- No hidden background generation.
- No auto-login.
- No scraping unrelated pages.
- No `<all_urls>` host permission.
- No remote scripts.
- No CDN scripts.
- No `eval`.
- No minified/obfuscated source for private use.
- All queue data stored locally.
- User manually starts the queue.
- User can pause/stop anytime.

### Privacy Statement for README

```text
Scene Flow stores queue data and settings locally in your browser using chrome.storage.local.
It does not send prompts, downloads, account data, cookies, or page data to any external server.
```

---

## 16. Anti-Spam / Safe Automation Guardrails

The extension should behave like a controlled local assistant, not a spam bot.

### Guardrails

- Only one prompt runs at a time.
- Default cooldown after each result: `10 seconds`.
- Cooldown should be configurable.
- Optional random cooldown range can be added later.
- No parallel generation.
- Manual Start required.
- Queue must be visible to the user.
- Tab must remain open.
- Stop/Pause must be available.
- Max retries per prompt.
- Max wait timeout per prompt.
- Optional daily/session cap can be added later.

### Recommended Defaults

```text
cooldownSeconds: 10
maxWaitMinutesPerPrompt: 15
maxRetries: 1
parallelism: 1
```

---

## 17. DOM Selector Strategy

Google Flow UI can change, so selectors must be isolated.

Do not hardcode selectors everywhere.

Use one file:

```text
src/content/dom-selectors.ts
```

Suggested selector functions:

```ts
findPromptInput(): HTMLElement | null
findGenerateButton(): HTMLButtonElement | null
findResultCards(): HTMLElement[]
findDownloadButtonForNewestResult(): HTMLButtonElement | null
findLoadingIndicators(): HTMLElement[]
```

### Selector Priority

Prefer stable selectors in this order:

```text
1. aria-label
2. role
3. visible text
4. semantic element type
5. fallback CSS selector
```

Avoid depending on random generated class names.

Bad:

```ts
document.querySelector(".xYz-123-random")
```

Better:

```ts
document.querySelector("textarea")
```

or:

```ts
[...document.querySelectorAll("button")]
  .find(button => /download/i.test(button.textContent ?? ""))
```

Best if available:

```ts
document.querySelector('[aria-label*="Download"]')
```

---

## 18. Message Passing

Use typed messages between popup, background, and content script.

Example message types:

```ts
type ExtensionMessage =
  | { type: "QUEUE_LOAD"; items: QueueItem[] }
  | { type: "QUEUE_START" }
  | { type: "QUEUE_PAUSE" }
  | { type: "QUEUE_RESUME" }
  | { type: "QUEUE_STOP" }
  | { type: "SUBMIT_PROMPT"; item: QueueItem }
  | { type: "PROMPT_SUBMITTED"; itemId: string }
  | { type: "RESULT_READY"; itemId: string }
  | { type: "DOWNLOAD_TRIGGERED"; itemId: string }
  | { type: "ITEM_DONE"; itemId: string }
  | { type: "ITEM_FAILED"; itemId: string; error: string };
```

---

## 19. Storage Model

Use `chrome.storage.local`.

Suggested keys:

```text
sceneFlow.settings
sceneFlow.queue
sceneFlow.currentItem
sceneFlow.runnerState
sceneFlow.lastRun
```

Example settings:

```ts
type SceneFlowSettings = {
  outputFolder: string;
  cooldownSeconds: number;
  maxWaitMinutesPerPrompt: number;
  maxRetries: number;
  expectedExtension: "png" | "jpg" | "webp" | "mp4";
};
```

Default settings:

```ts
export const DEFAULT_SETTINGS = {
  outputFolder: "google-flow-images",
  cooldownSeconds: 10,
  maxWaitMinutesPerPrompt: 15,
  maxRetries: 1,
  expectedExtension: "png"
};
```

---

## 20. Parser Implementation

### Parser Regex

```ts
const TIMESTAMP_BLOCK_RE =
  /^\s*\[(?<time>(?:\d{1,2}:)?\d{1,2}:\d{2})\](?:\s+(?<title>[^\n]+))?\s*$/gm;
```

### Parser Output

```ts
type ParsedPrompt = {
  index: number;
  timestamp: string;
  safeTimestamp: string;
  title?: string;
  safeTitle?: string;
  prompt: string;
};
```

### Parser Validation

The parser should detect:

- No timestamps found.
- Duplicate timestamps.
- Empty prompt body.
- Invalid timestamp format.
- Prompt body too short.
- Unsupported file type.
- Too many prompts, if a limit is added later.

### Parser Tests

Test cases:

```text
1. Parses basic [00:00] blocks.
2. Parses optional title.
3. Parses multiline prompt body.
4. Supports [1:02:15].
5. Rejects empty file.
6. Warns on duplicate timestamps.
7. Sanitizes filename parts.
8. Keeps prompt body unchanged.
```

---

## 21. Filename Builder

### Function

```ts
function buildTargetFilename(item: QueueItem): string {
  const index = String(item.index).padStart(3, "0");
  const time = item.safeTimestamp;
  const title = item.safeTitle ? `_${item.safeTitle}` : "";
  const ext = item.expectedExtension;

  return `${item.outputFolder}/${index}_${time}${title}.${ext}`;
}
```

### Example

Input:

```ts
{
  index: 2,
  timestamp: "00:04",
  safeTimestamp: "00-04",
  title: "doorway confusion",
  safeTitle: "doorway_confusion",
  outputFolder: "google-flow-images",
  expectedExtension: "png"
}
```

Output:

```text
google-flow-images/002_00-04_doorway_confusion.png
```

---

## 22. Suggested Implementation Order

### Phase 1 — Repository Setup

Goal:

Set up a clean TypeScript Chrome extension project.

Tasks:

- Create repo: `scene-flow`.
- Add `package.json`.
- Add TypeScript.
- Add Vite.
- Add ESLint.
- Add Prettier.
- Add Vitest.
- Add base folder structure.
- Add `.gitignore`.
- Add initial `README.md`.
- Add this `IMPLEMENTATION_PLAN.md`.

Acceptance criteria:

- `npm install` works.
- `npm run build` works.
- `npm test` works.
- Empty extension can be loaded from `dist/`.

---

### Phase 2 — Manifest V3 and Basic Extension Shell

Goal:

Create a loadable Chrome extension.

Tasks:

- Add `manifest.json`.
- Add extension name: `Scene Flow`.
- Add popup files.
- Add service worker.
- Add content script registration or scripting injection.
- Add minimal icon placeholders.
- Add permissions:
  - `storage`
  - `activeTab`
  - `downloads`
  - `scripting`
- Add host permission:
  - `https://flow.google.com/*`

Acceptance criteria:

- Extension loads in `chrome://extensions`.
- Popup opens.
- Service worker registers.
- No unnecessary permissions are requested.

---

### Phase 3 — Markdown Parser

Goal:

Parse timestamped `.md` files into queue items.

Tasks:

- Implement `markdown-parser.ts`.
- Implement timestamp normalization.
- Implement safe timestamp conversion.
- Implement safe title conversion.
- Implement parser validation.
- Add parser unit tests.

Acceptance criteria:

- Uploading valid `.md` returns parsed prompt list.
- Invalid file shows useful error.
- Queue items include timestamp, title, prompt body, and target filename.

---

### Phase 4 — Popup Queue UI

Goal:

Allow user to upload file and control queue.

Tasks:

- Add file input.
- Read `.md` file with browser FileReader.
- Parse file.
- Render queue table.
- Add Start/Pause/Resume/Stop buttons.
- Add settings fields:
  - output folder
  - cooldown seconds
  - max wait minutes
  - max retries
  - expected extension
- Save queue/settings to `chrome.storage.local`.

Acceptance criteria:

- User can upload `.md`.
- Queue appears in popup.
- Settings persist after popup closes.
- Queue persists after popup closes.

---

### Phase 5 — Content Script Automation MVP

Goal:

Submit one prompt into Google Flow.

Tasks:

- Implement `findPromptInput()`.
- Implement `setPromptText()`.
- Implement `findGenerateButton()`.
- Implement `clickGenerate()`.
- Implement message listener for `SUBMIT_PROMPT`.
- Return success/failure to background.

Acceptance criteria:

- User can click a test button.
- Prompt appears in Google Flow input.
- Generate button is clicked.
- Errors are shown if input/button cannot be found.

---

### Phase 6 — Result Watcher

Goal:

Detect when the generated result is ready.

Tasks:

- Implement result count snapshot before submit.
- Implement `MutationObserver`.
- Detect newest result card.
- Detect loading completed.
- Detect download button enabled.
- Add timeout handling.
- Report `RESULT_READY`.

Acceptance criteria:

- Extension waits while generation is running.
- Extension detects ready result.
- Timeout marks item failed instead of hanging forever.

---

### Phase 7 — Download Variant A

Goal:

Click existing Google Flow download button and rename file.

Tasks:

- Implement current queue item context in storage/background.
- Implement `download-router.ts`.
- Listen to `chrome.downloads.onDeterminingFilename`.
- Suggest filename under `google-flow-images/`.
- Add conflict action:
  - `uniquify`
- Content script clicks download button for newest result.

Acceptance criteria:

- Download is saved to:

```text
Downloads/google-flow-images/
```

- Filename follows format:

```text
001_00-00_title.png
```

- Duplicate filenames become unique instead of failing.

---

### Phase 8 — Queue Runner

Goal:

Run full serial queue.

Tasks:

- Implement runner loop.
- Pick next pending item.
- Mark statuses correctly.
- Submit prompt.
- Wait for result.
- Trigger download.
- Wait for download event.
- Mark done.
- Wait cooldown.
- Continue to next.
- Implement pause/resume/stop.
- Persist state after every important transition.

Acceptance criteria:

- Queue runs one item at a time.
- Next prompt starts only after current download is triggered/completed.
- Cooldown happens between items.
- Pause prevents next item from starting.
- Stop cancels remaining work.
- Failed item does not block the whole queue forever.

---

### Phase 9 — Error Handling and Recovery

Goal:

Make MVP reliable enough for real use.

Tasks:

- Add human-readable errors.
- Add retry handling.
- Add queue recovery after popup closes.
- Add status refresh.
- Add logs in local storage or console.
- Add “Reset Queue” button.
- Add “Retry Failed” button.

Acceptance criteria:

- User understands why an item failed.
- Failed items can be retried.
- Popup close does not erase queue.
- Reloading the Flow page does not corrupt queue state.

---

### Phase 10 — Manual Testing

Goal:

Test with real workflow.

Test scenarios:

```text
1. 3 prompt .md file.
2. 10 prompt .md file.
3. Prompt with multiline style notes.
4. Prompt with duplicate timestamp.
5. Prompt with missing title.
6. Prompt that takes too long.
7. User pauses during cooldown.
8. User stops during waiting result.
9. Download filename conflict.
10. Google Flow tab not active/open.
```

Acceptance criteria:

- Extension does not start unless Google Flow tab is open.
- It does not submit multiple prompts at once.
- It downloads into correct subfolder.
- It recovers gracefully from common failures.

---

## 23. Future Improvements

These should be considered after the MVP is stable.

### Feature Ideas

- Download Variant B.
- Multiple output folders per project.
- Project name prefix:

```text
google-flow-images/{projectName}/001_00-00_title.png
```

- Export queue status as JSON.
- Import existing queue.
- Retry failed only.
- Skip item.
- Reorder queue.
- Dry-run mode.
- Error screenshot capture.
- Selector configuration panel.
- Random cooldown range:

```text
10-20 seconds
```

- Session cap:

```text
max 30 prompts per session
```

- Support multiple timestamp formats:

```text
00:00 - prompt
00:00 | title
## 00:00 title
```

- Support video downloads:

```text
expectedExtension: "mp4"
```

- Browser support:
  - Edge
  - Brave
  - Chromium-based browsers

---

## 24. Key Risks and Mitigations

### Risk 1 — Google Flow UI Changes

Problem:

Selectors can break when the website changes.

Mitigation:

- Isolate selectors in `dom-selectors.ts`.
- Use robust selector priority.
- Add useful error messages.
- Add selector debug mode later.

---

### Risk 2 — Download Filename Mismatch

Problem:

`onDeterminingFilename` may rename the wrong download if multiple downloads start at the same time.

Mitigation:

- Run only one item at a time.
- Store `currentQueueItem` immediately before clicking download.
- Clear current item after download begins.
- Avoid triggering unrelated downloads while queue is running.

---

### Risk 3 — Service Worker Sleeps

Problem:

Manifest V3 service worker can stop when idle.

Mitigation:

- Persist queue state in `chrome.storage.local`.
- Do not depend only on in-memory variables.
- Rehydrate state on service worker startup.
- Keep runner transitions explicit.

---

### Risk 4 — Result Completion Detection Is Unreliable

Problem:

The page may show result elements before media is fully ready.

Mitigation:

- Require clickable download button.
- Add short stabilization delay after button appears.
- Use timeout and retry.
- Later add stronger card-level detection.

---

### Risk 5 — Extension Looks Suspicious

Problem:

Too many permissions make the extension feel unsafe.

Mitigation:

- Minimal permissions.
- No `<all_urls>`.
- No cookies.
- No history.
- No remote code.
- Clear README privacy statement.
- Local-only design.

---

## 25. MVP Definition of Done

The MVP is done when:

- User can load extension unpacked in Chrome.
- User can upload timestamped `.md` file.
- Extension parses prompts into queue.
- User can start queue manually.
- Extension submits exactly one prompt at a time.
- Extension waits for result readiness.
- Extension clicks existing Google Flow download button.
- Downloaded files are saved under:

```text
Downloads/google-flow-images/
```

- Downloaded filenames follow:

```text
001_00-00_title.png
```

- Extension waits 10 seconds after each completed item.
- Extension continues with next item.
- User can pause, resume, and stop.
- Queue state is stored locally.
- No external data transmission exists.
- No unnecessary permissions are used.

---

## 26. Recommended First GitHub Issues

### Issue 1 — Initialize Scene Flow Extension Project

Create TypeScript + Vite + Manifest V3 project skeleton.

### Issue 2 — Add Markdown Timestamp Parser

Parse `[MM:SS] title` blocks into queue items.

### Issue 3 — Add Popup Queue UI

Implement upload, settings, and queue display.

### Issue 4 — Add Google Flow Content Script

Submit one prompt into Google Flow manually from popup.

### Issue 5 — Add Result Watcher

Detect new result and ready download button.

### Issue 6 — Add Download Filename Router

Use `chrome.downloads.onDeterminingFilename` to save files into `google-flow-images/`.

### Issue 7 — Implement Serial Queue Runner

Run prompts one by one with cooldown, status changes, and retries.

### Issue 8 — Add Pause/Resume/Stop

Implement safe controls for queue execution.

### Issue 9 — Add Error Handling and Recovery

Improve failed item handling, retry, and persisted state.

### Issue 10 — Manual Test Pass

Test against real Google Flow workflow and document known limitations.

---

## 27. Recommended Development Strategy

Do not build everything at once.

Best order:

```text
Parser first.
Then popup.
Then one-prompt submit.
Then result detection.
Then download naming.
Then full queue runner.
Then hardening.
```

Reason:

The parser and filename logic are stable and easy to test. Google Flow DOM automation is the fragile part, so it should be isolated and added after the core local workflow is working.

---

## 28. Final Product Summary

Scene Flow is a private Chrome extension that turns a timestamped Markdown prompt file into a controlled Google Flow scene-generation queue.

It should be:

```text
local-first
privacy-friendly
serial
safe
minimal-permission
timestamp-based
download-folder-aware
easy to pause/stop
easy to debug
```

The MVP should stay intentionally simple:

```text
.md upload
timestamp parser
queue
one-by-one submit
wait for result
download using Variant A
save into Downloads/google-flow-images
10 second cooldown
next prompt
```

This is enough to solve the real workflow while keeping the extension clean, understandable, and low-risk.
