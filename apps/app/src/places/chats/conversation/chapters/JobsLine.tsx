// The job line is its own component so that its reads and its clock re-render only itself, never the message column (a tick of the "2 min" words must not draw 5,000 rows).
import type { ReactElement } from "react";
import { JobLines } from "./JobLines.tsx";
import { useJobs } from "./jobs.ts";

export function JobsLine(p: {
  call: ((cap: string, input: unknown) => Promise<unknown>) | undefined;
  agentIds: readonly string[];
  working: boolean;
}): ReactElement {
  const j = useJobs({ call: p.call, agentIds: p.agentIds, working: p.working, now: Date.now });
  return <JobLines running={j.running} finished={j.finished} now={Date.now()} />;
}
