# vault.item.delete

Move an item to Trash

| | |
|---|---|
| Module | vault |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | manage |
| Risk | medium |
| Resource | vault_item (/itemId) |
| Gate | delete when actor.kind != 'person' |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/vault/item/delete |
| MCP tool | vault_item_delete (vault) |
| CLI | none |
| Emits | vault.item_deleted |

## Input

```ts
type In = {
  itemId: string;
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
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "itemId": "vit_a1b2c3"
  },
  "output": {
    "ok": true
  }
}
```
