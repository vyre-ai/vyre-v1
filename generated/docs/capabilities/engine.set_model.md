# engine.set_model

Set the model, provider, effort and paying account of an agent in a thread

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | thread (/threadId) |
| Gate | none |
| Idempotency | natural |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/engine/set_model |
| MCP tool | engine_set_model (chats) |
| CLI | none |
| Emits | agent.model_changed |

## Input

```ts
type In = {
  threadId: string;
  agentId: string;
  model?: string;
  provider?: string;
  effort?: "low" | "medium" | "high" | "max";
  accountRef?: string;
};
```

## Output

```ts
type Out = {
  model: string;
  provider: string;
  effort?: "low" | "medium" | "high" | "max";
  accountRef?: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.provider_label
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "accountRef": "#Team_Anthropic_Key",
    "agentId": "agt_a1b2c3",
    "effort": "low",
    "model": "example",
    "provider": "example",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "accountRef": "#Team_Anthropic_Key",
    "effort": "low",
    "model": "example",
    "provider": "example"
  }
}
```
