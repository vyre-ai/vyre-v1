# connectors.outbox.cancel

Cancel a pending push (the local edit stays, marked not synced)

| | |
|---|---|
| Module | connectors |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | connectors.manage |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/connectors/outbox/cancel |
| MCP tool | connectors_outbox_cancel (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  outboxId: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "outboxId": "obx_a1b2c3"
  },
  "output": {
    "ok": true
  }
}
```
