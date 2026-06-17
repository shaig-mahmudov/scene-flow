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

export function isRunnableFlowProjectUrl(url: string | undefined): boolean {
  if (!url) return false;

  try {
    const parsed = new URL(url);
    if (parsed.origin === "https://labs.google") {
      return parsed.pathname.startsWith("/fx/tools/flow/project/");
    }

    return parsed.origin === "https://flow.google.com";
  } catch {
    return false;
  }
}

export function supportedFlowUrlMessage(): string {
  return "Open a specific Google Flow project tab before starting, or open the Scene Flow window from that project tab.";
}
