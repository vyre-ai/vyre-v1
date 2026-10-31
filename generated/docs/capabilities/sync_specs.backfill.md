# sync_specs.backfill

Bring in everything, not just the first-pull filter: re-applies the stored spec with the filter dropped and starts the pull

| | |
|---|---|
| Module | connectors |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | connectors.manage |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/sync_specs/backfill |
| MCP tool | sync_specs_backfill (records) |
| CLI | none |
| Emits | connector.published |

## Input

```ts
type In = {
  type: string;
  account?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  runId?: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "account": "example",
    "idempotencyKey": "idem_1",
    "type": "contact"
  },
  "output": {
    "runId": "run_a1b2c3"
  }
}
```
