export function logInfo(message: string, details?: unknown): void {
  console.info(`[Scene Flow] ${message}`, details ?? "");
}

export function logError(message: string, details?: unknown): void {
  console.error(`[Scene Flow] ${message}`, details ?? "");
}
