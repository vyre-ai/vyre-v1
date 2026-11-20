# runs.tree.find

The trees of agent work that ran in a chat or in a helper's own thread, newest first, with the root of each (only those the person may see; full says whether they see all of it or only that it goes on)

| | |
|---|---|
| Module | runs |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/runs/tree/find |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
  active?: boolean;
  limit?: number;
};
```

## Output

```ts
type Out = {
  roots: Array<{
      rootRun: string;
      runId: string;
      kind: "turn" | "subagent" | "helper" | "crew" | "handoff" | "ask" | "routine" | "wait" | "watcher" | "terminal" | "job" | "mcp" | "other";
      status: "queued" | "running" | "waiting" | "paused" | "succeeded" | "failed" | "stopped";
      startedAt: number;
      endedAt?: number;
      full: boolean;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "active": true,
    "limit": 1,
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "roots": [
      {
        "endedAt": 1760000000000,
        "full": true,
        "kind": "turn",
        "rootRun": "run_a1b2c3",
        "runId": "run_a1b2c3",
        "startedAt": 1760000000000,
        "status": "queued"
      }
    ]
  }
}
```
