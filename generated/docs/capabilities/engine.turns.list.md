# engine.turns.list

Turns of a thread, newest first

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | thread (/threadId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/engine/turns/list |
| MCP tool | engine_turns_list (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
  state?: Array<"queued" | "running" | "waiting" | "completed" | "failed" | "cancelled">;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  turns: Array<{
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
    }>;
  next?: string;
  total?: number;
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
    "cursor": "example",
    "limit": 1,
    "state": [
      "queued"
    ],
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "next": "example",
    "total": 1,
    "turns": [
      {
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
    ]
  }
}
```
