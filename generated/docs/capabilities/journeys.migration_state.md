# journeys.migration_state

Where the move onto the pipeline stands

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
| HTTP | POST /v1/journeys/migration_state |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  journeyId: string;
};
```

## Output

```ts
type Out = {
  mode: "subject" | "migrating" | "pipeline";
  total: number;
  done: number;
  failed: Array<{
      recordId: string;
      error: string;
    }>;
  states: unknown;
  pending: number;
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
    "journeyId": "jrn_a1b2c3"
  },
  "output": {
    "done": 1,
    "failed": [
      {
        "error": "example",
        "recordId": "rec_a1b2c3"
      }
    ],
    "mode": "subject",
    "pending": 1,
    "states": {},
    "total": 1
  }
}
```
