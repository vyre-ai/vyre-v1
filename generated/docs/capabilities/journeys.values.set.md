# journeys.values.set

Keep a Journey value for a record

| | |
|---|---|
| Module | journeys |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | record (/recordId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/journeys/values/set |
| MCP tool | journeys_values_set (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  recordId: string;
  key: string;
  value: unknown;
};
```

## Output

```ts
type Out = {
  recordId: string;
  key: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "key": "example",
    "recordId": "rec_a1b2c3",
    "value": {}
  },
  "output": {
    "key": "example",
    "recordId": "rec_a1b2c3"
  }
}
```
