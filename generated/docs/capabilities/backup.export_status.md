# backup.export_status

Read current-owner private export readiness and file metadata

| | |
|---|---|
| Module | backup |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | server.backups |
| Grant level | manage |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/backup/export_status |
| MCP tool | backup_export_status (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  runId: string;
};
```

## Output

```ts
type Out = {
  runId: string;
  state: "ready";
  fileId: string;
  name: string;
  sizeBytes: number;
  expiresAt: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "runId": "run_a1b2c3"
  },
  "output": {
    "expiresAt": 1760000000000,
    "fileId": "fil_a1b2c3",
    "name": "example",
    "runId": "run_a1b2c3",
    "sizeBytes": 1,
    "state": "ready"
  }
}
```
