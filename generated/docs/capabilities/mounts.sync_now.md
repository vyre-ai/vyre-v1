# mounts.sync_now

Sync a mount now (a Run); the provider change feed and the folder both move

| | |
|---|---|
| Module | mounts |
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
| HTTP | POST /v1/mounts/sync_now |
| MCP tool | mounts_sync_now (files) |
| CLI | vyre mounts sync |
| Emits | mount.synced, mount.failed, file.version_added, file.conflict_kept |

## Input

```ts
type In = {
  mountId: string;
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
    "idempotencyKey": "idem_1",
    "mountId": "mnt_a1b2c3"
  },
  "output": {
    "runId": "run_a1b2c3"
  }
}
```
