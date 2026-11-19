# run.node_state

A node of the agent work tree changed state

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
  from?: "queued" | "running" | "waiting" | "paused" | "succeeded" | "failed" | "stopped";
  to: "queued" | "running" | "waiting" | "paused" | "succeeded" | "failed" | "stopped";
  why: "started" | "claimed" | "slept" | "woke" | "paused" | "resumed" | "done" | "failed" | "stopped" | "worker_lost" | "budget" | "stuck" | "parent_stopped" | "parent_paused" | "retry" | "lease_lost";
};
```
