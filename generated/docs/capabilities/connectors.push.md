# connectors.push

Write one outbox item to the remote app (called by the outbox consumer only)

| | |
|---|---|
| Module | connectors |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | grant only |
| Grant level | use |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/connectors/push |
| MCP tool | none |
| CLI | none |
| Emits | sync.pushed, sync.push_failed |

## Input

```ts
type In = {
  outboxId: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  state: "sent" | "failed";
  error?: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.auth_failed
- provider.network
- provider.rate_limited
- provider.unavailable
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
    "outboxId": "obx_a1b2c3"
  },
  "output": {
    "error": "example",
    "state": "sent"
  }
}
```
