# sync.status

Sync state of this device: head, cursor, lag, epoch and the last full snapshot

| | |
|---|---|
| Module | sync |
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
| HTTP | POST /v1/sync/status |
| MCP tool | sync_status (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  deviceId?: string;
};
```

## Output

```ts
type Out = {
  head: number;
  cursor: number;
  lag: number;
  epoch: number;
  lastSnapshotAt?: number;
  openConflicts: number;
  mode: "live" | "update_required" | "resync" | "purge";
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
    "deviceId": "dev_a1b2c3"
  },
  "output": {
    "cursor": 1,
    "epoch": 1,
    "head": 1,
    "lag": 1,
    "lastSnapshotAt": 1760000000000,
    "mode": "live",
    "openConflicts": 1
  }
}
```
