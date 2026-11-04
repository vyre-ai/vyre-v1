# engine.helpers.change_model

Change the model of one helper of a chat: it stops, then starts again on the account and model the person picked, doing its brief from the start

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
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/engine/helpers/change_model |
| MCP tool | engine_helpers_change_model (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
  helperId: string;
  account?: string;
  model?: string;
};
```

## Output

```ts
type Out = {
  restarted: boolean;
  model: string;
  account: string;
  fellBackFrom?: string;
  spentMicros: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.unavailable
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "account": "example",
    "helperId": "thr_a1b2c3",
    "model": "example",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "account": "example",
    "fellBackFrom": "example",
    "model": "example",
    "restarted": true,
    "spentMicros": 1
  }
}
```
