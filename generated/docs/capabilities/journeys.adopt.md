# journeys.adopt

Bring the records a pipeline's type already had into the Journey where their stage field says they are, a page at a time; runs nothing for them and skips records that are in already

| | |
|---|---|
| Module | journeys |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | journeys.manage |
| Grant level | manage |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/journeys/adopt |
| MCP tool | journeys_adopt (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  journeyId: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  adopted: number;
  skipped: number;
  next?: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "cursor": "example",
    "journeyId": "jrn_a1b2c3",
    "limit": 1
  },
  "output": {
    "adopted": 1,
    "next": "example",
    "skipped": 1
  }
}
```
