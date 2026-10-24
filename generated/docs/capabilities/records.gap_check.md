# records.gap_check

Run the gap-check rules of a type over one record or all of them: finds missing or stale fields and names the fill route (AI field, agent lookup, teammate task or collection form)

| | |
|---|---|
| Module | records |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | records.edit |
| Grant level | edit |
| Risk | medium |
| Resource | record_type (/type) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/records/gap_check |
| MCP tool | records_gap_check (records) |
| CLI | none |
| Emits | record.gaps_found |

## Input

```ts
type In = {
  type: string;
  recordId?: string;
};
```

## Output

```ts
type Out = {
  gaps: Array<{
      recordId: string;
      field: string;
      reason: "missing" | "stale";
      route: "ai_field" | "agent_lookup" | "task" | "form";
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "recordId": "rec_a1b2c3",
    "type": "contact"
  },
  "output": {
    "gaps": [
      {
        "field": "example",
        "reason": "missing",
        "recordId": "rec_a1b2c3",
        "route": "ai_field"
      }
    ]
  }
}
```
