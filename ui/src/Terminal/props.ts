// Frozen props for ui/Terminal (spec 2.7, ARCH 7.2).
// One session, three hosts. The server host stays locked until server.services is granted.

import type { Density } from "../kit/types.ts";

export const TERMINAL_HOSTS = ["agent", "server", "device"] as const;

export type TerminalHost = (typeof TERMINAL_HOSTS)[number];

export type TerminalSessionState = "running" | "exited";

export interface TerminalProps {
  sessionId: string;
  title: string;
  host: TerminalHost;
  /** Shown on the host chip, for example the agent computer name. */
  hostLabel: string;
  state?: TerminalSessionState;
  command?: string;
  output?: string;
  starred?: boolean;
  /** Server shell without server.services. Ask for access, never a disabled prompt. */
  locked?: boolean;
  readonly?: boolean;
  density?: Density;
  onHost?: (host: TerminalHost) => void;
  onStar?: (sessionId: string) => void;
  onAskAccess?: () => void;
}

export function terminalLabel(props: TerminalProps): string {
  return props.title.length > 0 ? props.title : "Terminal";
}
