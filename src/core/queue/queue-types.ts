export type ExpectedExtension = "png" | "jpg" | "webp" | "mp4";

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

export type RunnerStatus = "idle" | "ready" | "running" | "paused" | "stopping" | "completed";

export type SceneFlowSettings = {
  outputFolder: string;
  cooldownSeconds: number;
  maxWaitMinutesPerPrompt: number;
  maxRetries: number;
  expectedExtension: ExpectedExtension;
};

export type QueueItem = {
  id: string;
  index: number;
  timestamp: string;
  safeTimestamp: string;
  title?: string;
  safeTitle?: string;
  prompt: string;
  outputFolder: string;
  expectedExtension: ExpectedExtension;
  targetFilename: string;
  status: QueueStatus;
  attempts: number;
  maxRetries: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
};

export type RunnerState = {
  status: RunnerStatus;
  activeItemId?: string;
  pauseRequested: boolean;
  stopRequested: boolean;
  updatedAt: number;
  error?: string;
};

export type ParsedPrompt = {
  index: number;
  timestamp: string;
  safeTimestamp: string;
  title?: string;
  safeTitle?: string;
  prompt: string;
};

export type ParseWarning = {
  code: "duplicate_timestamp";
  message: string;
  timestamp: string;
};

export type ParseResult = {
  prompts: ParsedPrompt[];
  warnings: ParseWarning[];
};
