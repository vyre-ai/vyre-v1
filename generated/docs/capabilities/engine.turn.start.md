# engine.turn.start

Start a queued turn on the placement chosen (host or device); records account, engine and model

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | low |
| Resource | thread (/threadId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/engine/turn/start |
| MCP tool | none |
| CLI | none |
| Emits | turn.started |

## Input

```ts
type In = {
  threadId: string;
  agentId: string;
  qseq: number;
  placement: "host" | "device";
  accountRef?: string;
  engine: string;
  model: string;
};
```

## Output

```ts
type Out = {
  turn: {
    turnId: string;
    threadId: string;
    agentId: string;
    asker: string;
    accountRef?: string;
    engine: string;
    model: string;
    state: "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled";
    traceId: string;
    runId?: string;
    startedAt: number;
    endedAt?: number;
    tokensIn: number;
    tokensOut: number;
    costMicros: number;
    error?: {
      code: string;
      message: string;
      next: Array<{
          kind: string;
          label: string;
        }>;
      traceId: string;
    };
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "accountRef": "#Team_Anthropic_Key",
    "agentId": "agt_a1b2c3",
    "engine": "example",
    "model": "example",
    "placement": "host",
    "qseq": 1,
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "turn": {
      "accountRef": "#Team_Anthropic_Key",
      "agentId": "agt_a1b2c3",
      "asker": "example",
      "costMicros": 1,
      "endedAt": 1760000000000,
      "engine": "example",
      "error": {
        "code": "example",
        "message": "example",
        "next": [
          {
            "kind": "example",
            "label": "example"
          }
        ],
        "traceId": "0123456789abcdef0123456789abcdef"
      },
      "model": "example",
      "runId": "run_a1b2c3",
      "startedAt": 1760000000000,
      "state": "queued",
      "threadId": "thr_a1b2c3",
      "tokensIn": 1,
      "tokensOut": 1,
      "traceId": "0123456789abcdef0123456789abcdef",
      "turnId": "trn_a1b2c3"
    }
  }
}
```
