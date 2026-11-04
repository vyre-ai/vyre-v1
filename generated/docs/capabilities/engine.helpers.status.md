# engine.helpers.status

The helpers of a chat, live: each one working, done, needing a person or failed, the step it is on, one line of what it found, how long it took and what it cost

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
| HTTP | POST /v1/engine/helpers/status |
| MCP tool | engine_helpers_status (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
};
```

## Output

```ts
type Out = {
  helpers: Array<{
      threadId: string;
      title: string;
      agentId: string;
      provider?: string;
      accountLabel?: string;
      model?: string;
      why?: string;
      fellBackFrom?: string;
      state: "working" | "done" | "needs_you" | "failed" | "stopped";
      step?: string;
      found?: string;
      startedAt: number;
      endedAt?: number;
      elapsedMs: number;
      tokensIn: number;
      tokensOut: number;
      costMicros: number;
    }>;
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
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "helpers": [
      {
        "accountLabel": "example",
        "agentId": "agt_a1b2c3",
        "costMicros": 1,
        "elapsedMs": 1,
        "endedAt": 1760000000000,
        "fellBackFrom": "example",
        "found": "example",
        "model": "example",
        "provider": "example",
        "startedAt": 1760000000000,
        "state": "working",
        "step": "example",
        "threadId": "thr_a1b2c3",
        "title": "example",
        "tokensIn": 1,
        "tokensOut": 1,
        "why": "example"
      }
    ]
  }
}
```
