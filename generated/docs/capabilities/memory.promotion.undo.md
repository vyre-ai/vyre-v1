# memory.promotion.undo

Undo a promotion: the shared copy is closed and the personal fact stays

| | |
|---|---|
| Module | memory |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/memory/promotion/undo |
| MCP tool | memory_promotion_undo (memory) |
| CLI | none |
| Emits | memory.promotion_undone |

## Input

```ts
type In = {
  promotionId: string;
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

## Example

```json
{
  "name": "example",
  "input": {
    "promotionId": "prm_a1b2c3"
  },
  "output": {
    "ok": true
  }
}
```
