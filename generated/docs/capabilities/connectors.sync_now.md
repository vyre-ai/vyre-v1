# connectors.sync_now

Start a sync Run for a synced type or a connection; modes: incremental, reconcile, backfill, dry_run

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
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/connectors/sync_now |
| MCP tool | connectors_sync_now (records) |
| CLI | none |
| Emits | sync.completed, sync.conflict, sync.deletes_paused, sync.schema_changed, record.updated |

## Input

```ts
type In = {
  syncTypeId?: string;
  type?: string;
  connectionId?: string;
  mode?: "incremental" | "reconcile" | "backfill" | "dry_run";
  runAutomations?: boolean;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  runId: string;
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
    "connectionId": "con_a1b2c3",
    "idempotencyKey": "idem_1",
    "mode": "incremental",
    "runAutomations": true,
    "syncTypeId": "syt_a1b2c3",
    "type": "contact"
  },
  "output": {
    "runId": "run_a1b2c3"
  }
}
```
