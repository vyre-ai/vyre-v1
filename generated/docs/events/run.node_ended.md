# run.node_ended

A node of the agent work tree is over (done, failed or stopped); it carries no words, so everyone who may hear of it learns state only: read the node for what it found. Native nodes only: a routine, wait or terminal Run mirrored into the tree is waited for as a Run

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
