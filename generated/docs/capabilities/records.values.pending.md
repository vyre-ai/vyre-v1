# records.values.pending

Needs review: agent-filled values waiting for a reviewer, each with its source and time (counts into My work for the field reviewer role)

| | |
|---|---|
| Module | records |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | record_type (/type) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/records/values/pending |
| MCP tool | records_values_pending (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  type: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  values: Array<{
      recordId: string;
      type: string;
      field: string;
      value?: unknown;
      source: {
        kind: "agent" | "person" | "form" | "automation" | "sync" | "import";
        actor: string;
        link?: string;
        at: number;
        state: "counted" | "needs_review" | "rejected";
      };
    }>;
  next?: string;
  total?: number;
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
    "cursor": "example",
    "limit": 1,
    "type": "contact"
  },
  "output": {
    "next": "example",
    "total": 1,
    "values": [
      {
        "field": "example",
        "recordId": "rec_a1b2c3",
        "source": {
          "actor": "example",
          "at": 1760000000000,
          "kind": "agent",
          "link": "example",
          "state": "counted"
        },
        "type": "contact",
        "value": {}
      }
    ]
  }
}
```
