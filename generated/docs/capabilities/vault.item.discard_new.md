# vault.item.discard_new

Take back the key a connect card saved and could not connect: erased for good, from the Vault and from Trash. Only a person's own, only the one key that request saved, only while nothing has used it

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
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  itemId: string;
  requestId: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
};
```

## Errors

- internal.not_implemented
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
    "itemId": "vit_a1b2c3",
    "requestId": "vrq_a1b2c3"
  },
  "output": {
    "ok": true
  }
}
```
