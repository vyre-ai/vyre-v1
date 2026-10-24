# memory.promotion.reject

Reject a promotion request with a note

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
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/memory/promotion/reject |
| MCP tool | memory_promotion_reject (memory) |
| CLI | none |
| Emits | memory.promotion_rejected |

## Input

```ts
type In = {
  promotionId: string;
  note?: string;
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
    "note": "example",
    "promotionId": "prm_a1b2c3"
  },
  "output": {
    "ok": true
  }
}
```
