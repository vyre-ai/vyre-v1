# connectors.sync_run

Run the pass a sync_now asked for, in the background as the person who asked, and finish its Run (called by the scheduler)

| | |
|---|---|
| Module | connectors |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/connectors/sync_run |
| MCP tool | none |
| CLI | none |
| Emits | sync.completed, sync.conflict, sync.deletes_paused, sync.pushed, sync.push_failed, record.created, record.updated |

## Input

```ts
type In = {
  runId: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
  summary: string;
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
    "runId": "run_a1b2c3"
  },
  "output": {
    "ok": true,
    "summary": "example"
  }
}
```
