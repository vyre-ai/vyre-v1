# vault.item.discard_new

Take back a key you saved a moment ago that could not be connected: erased for good, from the Vault and from Trash. Only your own, only within two minutes, only while nothing has used it

| | |
|---|---|
| Module | vault |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | manage |
| Risk | medium |
| Resource | vault_item (/itemId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/vault/item/discard_new |
| MCP tool | vault_item_discard_new (vault) |
| CLI | none |
| Emits | none |

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
