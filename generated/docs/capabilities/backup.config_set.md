# backup.config_set

Set the backup target and schedule (one switch)

| | |
|---|---|
| Module | backup |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | server.backups |
| Grant level | manage |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/backup/config_set |
| MCP tool | backup_config_set (engineer) |
| CLI | none |
| Emits | backup.config_changed |

## Input

```ts
type In = {
  target: {
    kind: "s3" | "drive" | "local";
    bucket?: string;
    region?: string;
    path?: string;
    vaultName?: string;
  };
  schedule: string;
  enabled: boolean;
};
```

## Output

```ts
type Out = {
  ok: boolean;
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
    "enabled": true,
    "schedule": "0 3 * * *",
    "target": {
      "bucket": "example",
      "kind": "s3",
      "path": "example",
      "region": "example",
      "vaultName": "example"
    }
  },
  "output": {
    "ok": true
  }
}
```
