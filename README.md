# Scene Flow

Scene Flow is a private, local-first Chrome extension for running timestamped Markdown prompts through Google Flow one item at a time.

It parses blocks like:

```md
[00:00] lost_keys
A small minimalist stickman searches empty pockets for lost keys.

[00:04] doorway_confusion
A stickman pauses in a doorway, confused.
```

The popup stores the parsed queue and settings in `chrome.storage.local`, then the background service worker coordinates serial execution against the active Google Flow tab. Supported Flow URLs are `https://flow.google.com/*` and `https://labs.google/fx/tools/flow*`. Downloads are routed into `Downloads/google-flow-images/` by default with filenames such as `001_00-00_lost_keys.png`.

## Development

```bash
npm install
npm run build
npm test
```

Load the built extension from `dist/` in `chrome://extensions` with Developer Mode enabled.

## Privacy

Scene Flow stores queue data and settings locally in your browser using `chrome.storage.local`. It does not send prompts, downloads, account data, cookies, or page data to any external server.

## Current MVP Notes

- Runs one prompt at a time.
- Requires the Google Flow tab to be active before starting.
- Uses the visible page UI and the normal download button.
- Uses conservative DOM selector fallbacks because Google Flow UI can change.
- No analytics, remote scripts, cookies, history, or `<all_urls>` permission.
