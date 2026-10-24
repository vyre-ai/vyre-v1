# engine.turn.retry

Retry a failed turn, optionally on another model or backup key (the next step on a turn error)

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/engine/turn/retry |
| MCP tool | engine_turn_retry (chats) |
| CLI | none |
| Emits | turn.queued |

## Input

```ts
type In = {
  turnId: string;
  model?: string;
  provider?: string;
  accountRef?: string;
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
- permission.limit
- permission.no_grant
- permission.provider_label
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "accountRef": "#Team_Anthropic_Key",
    "model": "example",
    "provider": "example",
    "turnId": "trn_a1b2c3"
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
