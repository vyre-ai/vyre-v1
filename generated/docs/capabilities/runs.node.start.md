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
| Emits | run.node_state, run.node_ended |

## Input

```ts
type In = {
  kind: "turn" | "subagent" | "helper" | "crew" | "handoff" | "ask" | "routine" | "wait" | "watcher" | "terminal" | "job" | "mcp" | "other";
  name?: string;
  owner: string;
  parentRun?: string;
  parentThread?: string;
  threadId?: string;
  whoKind?: string;
  whoId?: string;
  whoName?: string;
  dependsOn?: Array<string>;
  dependsOnThreads?: Array<string>;
  adoptKey?: string;
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
    can?: {
      manage: boolean;
    };
    result?: unknown;
    evidence?: unknown;
    origin?: unknown;
    summary?: string;
    step?: {
      icon: "read" | "web" | "term" | "edit" | "find" | "think" | "send" | "cal" | "wait" | "kid";
      text: string;
    };
    need?: {
      requestId: string;
      what: string;
      why: string;
    };
    stuck?: {
      since: number;
      reason: string;
    };
    whoName?: string;
    dependsOn?: Array<string>;
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
    "adoptKey": "example",
    "brief": {},
    "budget": {},
    "dependsOn": [
      "run_a1b2c3"
    ],
    "dependsOnThreads": [
      "thr_a1b2c3"
    ],
    "engine": "example",
    "idemKey": "example",
    "kind": "turn",
    "model": "example",
    "name": "example",
    "origin": {},
    "owner": "example",
    "parentRun": "run_a1b2c3",
    "parentThread": "thr_a1b2c3",
    "policy": {},
    "running": true,
    "threadId": "thr_a1b2c3",
    "whoId": "example",
    "whoKind": "example",
    "whoName": "example"
  },
  "output": {
    "created": true,
    "node": {
      "attempt": 1,
      "brief": {},
      "budget": {},
      "can": {
        "manage": true
      },
      "dependsOn": [
        "run_a1b2c3"
      ],
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
      "need": {
        "requestId": "example",
        "what": "example",
        "why": "example"
      },
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
      "step": {
        "icon": "read",
        "text": "example"
      },
      "stopReason": "example",
      "stuck": {
        "reason": "example",
        "since": 1760000000000
      },
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
      "whoKind": "example",
      "whoName": "example"
    }
  }
}
```
