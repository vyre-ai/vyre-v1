# engine.turn.finish

End a turn as completed, failed or cancelled; always releases the lease

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/engine/turn/finish |
| MCP tool | none |
| CLI | none |
| Emits | turn.completed, turn.failed, turn.cancelled, agent.task_finished, agent.blocked |

## Input

```ts
type In = {
  turnId: string;
  outcome: "completed" | "failed" | "cancelled";
  error?: {
    code: string;
    message: string;
    next: Array<{
        kind: string;
        label: string;
      }>;
    traceId: string;
  };
  tokensIn?: number;
  tokensOut?: number;
  costMicros?: number;
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

## Example

```json
{
  "name": "example",
  "input": {
    "costMicros": 1,
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
    "outcome": "completed",
    "tokensIn": 1,
    "tokensOut": 1,
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
