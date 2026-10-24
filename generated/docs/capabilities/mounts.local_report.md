# mounts.local_report

A device reports changes in a mounted local folder and uploads their blobs (system)

| | |
|---|---|
| Module | mounts |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/mounts/local_report |
| MCP tool | none |
| CLI | none |
| Emits | file.version_added, file.conflict_kept, mount.synced |

## Input

```ts
type In = {
  mountId: string;
  deviceId: string;
  changes: Array<{
      path: string;
      op: "add" | "modify" | "delete" | "rename";
      blobId?: string;
      mtime: number;
      from?: string;
    }>;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  applied: number;
  conflicts: number;
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
    "changes": [
      {
        "blobId": "blb_a1b2c3",
        "from": "example",
        "mtime": 1760000000000,
        "op": "add",
        "path": "example"
      }
    ],
    "deviceId": "dev_a1b2c3",
    "idempotencyKey": "idem_1",
    "mountId": "mnt_a1b2c3"
  },
  "output": {
    "applied": 1,
    "conflicts": 1
  }
}
```
