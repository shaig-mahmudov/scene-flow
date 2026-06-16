const SUPPORTED_FLOW_ORIGINS = new Set(["https://flow.google.com", "https://labs.google"]);

export function isSupportedFlowUrl(url: string | undefined): boolean {
  if (!url) return false;

  try {
    const parsed = new URL(url);
    if (!SUPPORTED_FLOW_ORIGINS.has(parsed.origin)) return false;

    if (parsed.origin === "https://flow.google.com") {
      return true;
    }

    return parsed.pathname.startsWith("/fx/tools/flow");
  } catch {
    return false;
  }
}

export function supportedFlowUrlMessage(): string {
  return "Open Google Flow in the active tab before starting the queue. Supported URLs: flow.google.com or labs.google/fx/tools/flow.";
}
