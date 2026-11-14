// The job line is its own component so that its reads and its clock re-render only itself, never the message column (a tick of the "2 min" words must not draw 5,000 rows).
import type { ReactElement } from "react";
import { JobLines } from "./JobLines.tsx";
import { useMemo } from "react";
import { useJobs } from "./jobs.ts";
import type { TerminalFeed } from "./jobs.ts";

/** The part of the app's screen hooks the job line needs. */
export interface Screens {
  query(screen: string, name: string, state: Record<string, unknown>): unknown;
}

export function JobsLine(p: {
  screens: Screens | undefined;
  agentIds: readonly string[];
  shared?: boolean;
}): ReactElement {
  // a build without the screen, or a query that fails, draws nothing and makes no call
  const feed = useMemo(() => {
    try {
      return p.screens?.query("chats.terminal-list", "terminals", { host: "agent_computer" }) as
        | TerminalFeed
        | undefined;
    } catch {
      return undefined;
    }
  }, [p.screens]);
  const j = useJobs({ feed, agentIds: p.agentIds, now: Date.now });
  return <JobLines running={j.running} finished={j.finished} now={Date.now()} plain={p.shared === true} />;
}
