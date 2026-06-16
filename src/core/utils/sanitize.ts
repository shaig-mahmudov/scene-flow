export function sanitizeTimestamp(timestamp: string): string {
  return timestamp.trim().replaceAll(":", "-");
}

export function sanitizeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function sanitizeFolder(value: string): string {
  const folder = value
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .map(sanitizeSlug)
    .filter(Boolean)
    .join("/");

  return folder || "google-flow-images";
}
