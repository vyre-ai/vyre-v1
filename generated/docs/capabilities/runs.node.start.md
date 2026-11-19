# runs.node.start

Make a node in the agent work tree: a turn, helper, subagent, handoff, ask, watcher, terminal command or job (the engine, chat and terminal call this)

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
| HTTP | POST /v1/runs/node/start |
| MCP tool | none |
| CLI | none |
| Emits | run.node_state |

## Input

```ts
type In = {
  kind: "turn" | "subagent" | "helper" | "crew" | "handoff" | "ask" | "routine" | "watcher" | "terminal" | "job" | "mcp" | "other";
  name?: string;
  owner: string;
  parentRun?: string;
  threadId?: string;
  whoKind?: string;
  whoId?: string;
  engine?: string;
  model?: string;
  brief?: unknown;
  budget?: unknown;
  origin?: unknown;
  policy?: unknown;
  running?: boolean;
  idemKey?: string;
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
    kind: "turn" | "subagent" | "helper" | "crew" | "handoff" | "ask" | "routine" | "watcher" | "terminal" | "job" | "mcp" | "other";
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
  created: boolean;
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
    "brief": {},
    "budget": {},
    "engine": "example",
    "idemKey": "example",
    "kind": "turn",
    "model": "example",
    "name": "example",
    "origin": {},
    "owner": "example",
    "parentRun": "run_a1b2c3",
    "policy": {},
    "running": true,
    "threadId": "thr_a1b2c3",
    "whoId": "example",
    "whoKind": "example"
  },
  "output": {
    "created": true,
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
