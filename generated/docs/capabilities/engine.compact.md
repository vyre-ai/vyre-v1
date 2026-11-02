# engine.compact

Compact a chat: free the context of the agent's engine, keeping what the person names, and say so in one line with the context left. With always, the words are kept for every compaction of this chat

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | low |
| Resource | thread (/threadId) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/engine/compact |
| MCP tool | none |
| CLI | none |
| Emits | turn.compacted |

## Input

```ts
type In = {
  threadId: string;
  agentId?: string;
  keep?: string;
  always?: boolean;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  engine: string;
  how: "engine" | "vyre";
  line: string;
  context: {
    used: number;
    window: number;
  } | null;
  keepEvery: string;
  fellBack: boolean;
};
```

## Errors

- internal.unavailable
- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "agentId": "agt_a1b2c3",
    "always": true,
    "idempotencyKey": "idem_1",
    "keep": "the open questions about the lease",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "context": {
      "used": 1,
      "window": 1
    },
    "engine": "claude_code",
    "fellBack": true,
    "how": "engine",
    "keepEvery": "example",
    "line": "Compacted. Kept: the open questions about the lease. Context now about 14k of 200k tokens."
  }
}
```
