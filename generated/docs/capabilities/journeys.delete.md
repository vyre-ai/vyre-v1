# journeys.delete

Delete a Journey with no records in flight

| | |
|---|---|
| Module | journeys |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | journeys.manage |
| Grant level | manage |
| Risk | high |
| Resource | space |
| Gate | delete when actor.kind != 'person' |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/journeys/delete |
| MCP tool | journeys_delete (automations) |
| CLI | none |
| Emits | journey.deleted |

## Input

```ts
type In = {
  journeyId: string;
};
```

## Output

```ts
type Out = {
  deleted: boolean;
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
    "journeyId": "jrn_a1b2c3"
  },
  "output": {
    "deleted": true
  }
}
```
