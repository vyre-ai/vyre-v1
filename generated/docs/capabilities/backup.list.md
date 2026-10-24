# backup.list

List backups with size, sequence number and verification state

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
| HTTP | POST /v1/backup/list |
| MCP tool | backup_list (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  backups: Array<{
      backupId: string;
      at: number;
      sizeBytes: number;
      seq: number;
      kind: "scheduled" | "manual" | "pre_update";
      verified: boolean;
      target: string;
    }>;
  next?: string;
  total?: number;
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
    "cursor": "example",
    "limit": 1
  },
  "output": {
    "backups": [
      {
        "at": 1760000000000,
        "backupId": "bkp_a1b2c3",
        "kind": "scheduled",
        "seq": 1,
        "sizeBytes": 1,
        "target": "example",
        "verified": true
      }
    ],
    "next": "example",
    "total": 1
  }
}
```
