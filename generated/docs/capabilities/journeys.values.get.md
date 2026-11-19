# journeys.values.get

Values a Journey carries for a record

| | |
|---|---|
| Module | journeys |
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
| HTTP | POST /v1/journeys/values/get |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  recordId: string;
};
```

## Output

```ts
type Out = {
  values: Record<string, unknown>;
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
    "recordId": "rec_a1b2c3"
  },
  "output": {
    "values": {}
  }
}
```
