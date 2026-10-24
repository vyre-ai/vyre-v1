# records.value_source

Source popover of one value: who or what filled it, from where, when, and whether it counts yet

| | |
|---|---|
| Module | records |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | record (/recordId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/records/value_source |
| MCP tool | records_value_source (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  type: string;
  recordId: string;
  field: string;
};
```

## Output

```ts
type Out = {
  source: {
    kind: "agent" | "person" | "form" | "automation" | "sync" | "import";
    actor: string;
    link?: string;
    at: number;
    state: "counted" | "needs_review" | "rejected";
  };
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
    "field": "example",
    "recordId": "rec_a1b2c3",
    "type": "contact"
  },
  "output": {
    "source": {
      "actor": "example",
      "at": 1760000000000,
      "kind": "agent",
      "link": "example",
      "state": "counted"
    }
  }
}
```
