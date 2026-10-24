# sync_types.undo_push

Reverse one push using the stored replaced value

| | |
|---|---|
| Module | connectors |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | records.edit |
| Grant level | use |
| Risk | high |
| Resource | space |
| Gate | send when actor.kind != 'person' |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/sync_types/undo_push |
| MCP tool | sync_types_undo_push (records) |
| CLI | none |
| Emits | sync.push_undone |

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
  ok: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- provider.network
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
    "ok": true
  }
}
```
