# records.completeness

Completeness of one record (for example 8 of 11) with the missing fields; Ask for these turns the list into a short-lived form

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
| HTTP | POST /v1/records/completeness |
| MCP tool | records_completeness (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  type: string;
  recordId: string;
};
```

## Output

```ts
type Out = {
  filled: number;
  total: number;
  missing: Array<{
      field: string;
      title: string;
    }>;
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
    "recordId": "rec_a1b2c3",
    "type": "contact"
  },
  "output": {
    "filled": 1,
    "missing": [
      {
        "field": "example",
        "title": "example"
      }
    ],
    "total": 1
  }
}
```
