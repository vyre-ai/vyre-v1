export type SessionProvider = "codex" | "claude";
export type VisibleRole = "user" | "assistant";

export type DiscoveryOptions = {
  home?: string;
  codexHome?: string;
  claudeHome?: string;
};

/** A transcript found without opening its contents. */
export type SessionSource = {
  provider: SessionProvider;
  sessionId: string;
  sessionKey: string;
  projectKey: string;
  transcriptPath: string;
  cwd?: string;
  updatedAt?: string;
  /** Deliberately absent at discovery time: bodies are not read until selection. */
  messageCount?: undefined;
};

export type VisibleMessage = {
  id: string;
  parentId?: string;
  role: VisibleRole;
  text: string;
  at?: string;
};

export type ImportedSession = {
  provider: SessionProvider;
  sessionId: string;
  sessionKey: string;
  projectKey: string;
  cwd?: string;
  messages: VisibleMessage[];
  warnings: string[];
};
