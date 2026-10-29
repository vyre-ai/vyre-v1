# backup.config_get

Read the backup target, schedule and encryption status

| | |
|---|---|
| Module | backup |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | server.backups |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/backup/config_get |
| MCP tool | backup_config_get (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  target?: {
    kind: "s3" | "drive" | "local";
    bucket?: string;
    region?: string;
    path?: string;
    vaultName?: string;
  };
  schedule: string;
  enabled: boolean;
  encrypted: boolean;
  lastBackupAt?: number;
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
  "input": {},
  "output": {
    "enabled": true,
    "encrypted": true,
    "lastBackupAt": 1760000000000,
    "schedule": "example",
    "target": {
      "bucket": "example",
      "kind": "s3",
      "path": "example",
      "region": "example",
      "vaultName": "example"
    }
  }
}
```
