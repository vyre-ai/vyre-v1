# vault.connect_card.may_discard

Is this the one key the person's own connect card saved and has not yet connected? Asked by the Vault before it takes a key back

| | |
|---|---|
| Module | vault-requests |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/vault/connect_card/may_discard |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  requestId: string;
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
