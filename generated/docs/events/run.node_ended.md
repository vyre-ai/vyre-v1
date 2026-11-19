# run.node_ended

A node of the agent work tree is over (done, failed or stopped); a Run that sleeps until it waits on this event

| | |
|---|---|
| Module | runs |
| Schema version | 1 |
| Subject | run at /runId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | run_logs |

## Payload

```ts
type Payload = {
  runId: string;
  rootRun: string;
  kind: "turn" | "subagent" | "helper" | "crew" | "handoff" | "ask" | "routine" | "wait" | "watcher" | "terminal" | "job" | "mcp" | "other";
  to: "succeeded" | "failed" | "stopped";
  summary?: string;
};
```
