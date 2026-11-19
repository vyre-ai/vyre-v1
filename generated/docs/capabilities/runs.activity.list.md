# runs.activity.list

Everything of the agent work tree that is running, asleep or paused for the person (or for everyone, for someone who manages runs), newest first

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
| HTTP | POST /v1/runs/activity/list |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  scope?: "mine" | "all";
  limit?: number;
};
```

## Output

```ts
type Out = {
  rows: Array<{
      runId: string;
      rootRun: string;
      kind: "turn" | "subagent" | "helper" | "crew" | "handoff" | "ask" | "routine" | "wait" | "watcher" | "terminal" | "job" | "mcp" | "other";
      name?: string;
      whoKind: string;
      whoId?: string;
      whoName?: string;
      status: "queued" | "running" | "waiting" | "paused" | "succeeded" | "failed" | "stopped";
      step?: {
        icon: "read" | "web" | "term" | "edit" | "find" | "think" | "send" | "cal" | "wait" | "kid";
        text: string;
      };
      stuck?: {
        since: number;
        reason: string;
      };
      need?: {
        requestId: string;
        what: string;
        why: string;
      };
      wake?: {
        kind: "event" | "time" | "process" | "person" | "child" | "deps" | "log";
        label?: string;
        dueAt?: number;
        on?: unknown;
        wokeCount?: number;
      };
      startedAt: number;
      updatedAt: number;
      usdMicros: number;
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
    "limit": 1,
    "scope": "mine"
  },
  "output": {
    "rows": [
      {
        "kind": "turn",
        "name": "example",
        "need": {
          "requestId": "example",
          "what": "example",
          "why": "example"
        },
        "rootRun": "run_a1b2c3",
        "runId": "run_a1b2c3",
        "startedAt": 1760000000000,
        "status": "queued",
        "step": {
          "icon": "read",
          "text": "example"
        },
        "stuck": {
          "reason": "example",
          "since": 1760000000000
        },
        "updatedAt": 1760000000000,
        "usdMicros": 1,
        "wake": {
          "dueAt": 1760000000000,
          "kind": "event",
          "label": "example",
          "on": {},
          "wokeCount": 1
        },
        "whoId": "example",
        "whoKind": "example",
        "whoName": "example"
      }
    ]
  }
}
```
