# engine.usage.get

For a chat and an account: the context used against the model window (from the latest turn and the model catalog) and the session and week limits exactly as the provider reported them. A provider that reports nothing gives null; nothing is estimated

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
| HTTP | POST /v1/engine/usage/get |
| MCP tool | engine_usage_get (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
  agentId: string;
  accountRef?: string;
};
```

## Output

```ts
type Out = {
  account: {
    ref: string;
    name: string;
    provider: string;
    plan?: string;
  } | null;
  context: {
    used: number;
    window: number;
  } | null;
  session: {
    pct: number;
    resetsAt?: number;
  } | null;
  week: {
    pct: number;
    resetsAt?: number;
  } | null;
  source: "provider" | "estimate" | "none";
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
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "account": {
      "name": "Dana Claude Max",
      "plan": "example",
      "provider": "anthropic",
      "ref": "#Team_Anthropic_Key"
    },
    "context": {
      "used": 1,
      "window": 1
    },
    "session": {
      "pct": 1,
      "resetsAt": 1760000000000
    },
    "source": "provider",
    "week": {
      "pct": 1,
      "resetsAt": 1760000000000
    }
  }
}
```
