# runs.node.move

Move a node to another state; the one way a node changes state (a node already there answers as a no-op, a finished one refuses)

| | |
|---|---|
| Module | runs |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/runs/node/move |
| MCP tool | none |
| CLI | none |
| Emits | run.node_state, run.node_ended |

## Input

```ts
type In = {
  runId: string;
  to: "queued" | "running" | "waiting" | "paused" | "succeeded" | "failed" | "stopped";
  why: "started" | "claimed" | "slept" | "woke" | "paused" | "resumed" | "done" | "failed" | "stopped" | "worker_lost" | "budget" | "stuck" | "parent_stopped" | "parent_paused" | "retry" | "lease_lost";
  expectedVersion?: number;
  expectedFrom?: "queued" | "running" | "waiting" | "paused" | "succeeded" | "failed" | "stopped";
  summary?: string;
  result?: unknown;
  evidence?: unknown;
  error?: {
    code: string;
    message: string;
  };
  stopReason?: string;
  wake?: {
    kind: "event" | "time" | "process" | "person" | "child" | "deps" | "log";
    label?: string;
    dueAt?: number;
    on?: unknown;
    wokeCount?: number;
  };
  checkpoint?: unknown;
};
```

## Output

```ts
type Out = {
  node: {
    id: string;
    rootRun: string;
    parentRun?: string;
    depth: number;
    kind: "turn" | "subagent" | "helper" | "crew" | "handoff" | "ask" | "routine" | "wait" | "watcher" | "terminal" | "job" | "mcp" | "other";
    name?: string;
    owner: string;
    startedBy: string;
    whoKind: string;
    whoId?: string;
    engine?: string;
    model?: string;
    threadId?: string;
    status: "queued" | "running" | "waiting" | "paused" | "succeeded" | "failed" | "stopped";
    version: number;
    attempt: number;
    brief?: unknown;
    budget?: unknown;
    spent: {
      tokensIn: number;
      tokensOut: number;
      cacheRead: number;
      usdMicros: number;
      calls: number;
    };
    wake?: {
      kind: "event" | "time" | "process" | "person" | "child" | "deps" | "log";
      label?: string;
      dueAt?: number;
      on?: unknown;
      wokeCount?: number;
    };
    result?: unknown;
    evidence?: unknown;
    origin?: unknown;
    summary?: string;
    errorCode?: string;
    errorMessage?: string;
    stopReason?: string;
    leaseHolder?: string;
    leaseUntil?: number;
    startedAt: number;
    endedAt?: number;
    updatedAt: number;
  };
  changed: boolean;
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
    "checkpoint": {},
    "error": {
      "code": "example",
      "message": "example"
    },
    "evidence": {},
    "expectedFrom": "queued",
    "expectedVersion": 1,
    "result": {},
    "runId": "run_a1b2c3",
    "stopReason": "example",
    "summary": "example",
    "to": "queued",
    "wake": {
      "dueAt": 1760000000000,
      "kind": "event",
      "label": "example",
      "on": {},
      "wokeCount": 1
    },
    "why": "started"
  },
  "output": {
    "changed": true,
    "node": {
      "attempt": 1,
      "brief": {},
      "budget": {},
      "depth": 1,
      "endedAt": 1760000000000,
      "engine": "example",
      "errorCode": "example",
      "errorMessage": "example",
      "evidence": {},
      "id": "run_a1b2c3",
      "kind": "turn",
      "leaseHolder": "example",
      "leaseUntil": 1760000000000,
      "model": "example",
      "name": "example",
      "origin": {},
      "owner": "example",
      "parentRun": "run_a1b2c3",
      "result": {},
      "rootRun": "run_a1b2c3",
      "spent": {
        "cacheRead": 1,
        "calls": 1,
        "tokensIn": 1,
        "tokensOut": 1,
        "usdMicros": 1
      },
      "startedAt": 1760000000000,
      "startedBy": "example",
      "status": "queued",
      "stopReason": "example",
      "summary": "example",
      "threadId": "thr_a1b2c3",
      "updatedAt": 1760000000000,
      "version": 1,
      "wake": {
        "dueAt": 1760000000000,
        "kind": "event",
        "label": "example",
        "on": {},
        "wokeCount": 1
      },
      "whoId": "example",
      "whoKind": "example"
    }
  }
}
```
