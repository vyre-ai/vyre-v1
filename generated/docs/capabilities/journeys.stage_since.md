# journeys.stage_since

When records entered their current stage

| | |
|---|---|
| Module | journeys |
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
| HTTP | POST /v1/journeys/stage_since |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  journeyId: string;
  recordIds: Array<string>;
};
```

## Output

```ts
type Out = {
  since: Record<string, unknown>;
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
    "journeyId": "jrn_a1b2c3",
    "recordIds": [
      "rec_a1b2c3"
    ]
  },
  "output": {
    "since": {}
  }
}
```
