# engine.review.mark

Mark a sampled turn reviewed: fine, or flagged (which opens an incident)

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | ai.incidents |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/engine/review/mark |
| MCP tool | engine_review_mark (meta) |
| CLI | none |
| Emits | review.marked, incident.opened |

## Input

```ts
type In = {
  turnId: string;
  verdict: "ok" | "flagged";
  note?: string;
};
```

## Output

```ts
type Out = {
  incidentId?: string;
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
    "note": "example",
    "turnId": "trn_a1b2c3",
    "verdict": "ok"
  },
  "output": {
    "incidentId": "inc_a1b2c3"
  }
}
```
