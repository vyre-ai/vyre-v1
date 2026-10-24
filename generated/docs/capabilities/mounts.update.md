# mounts.update

Change mount options: server copy or live only, Review changes, read-only pull

| | |
|---|---|
| Module | mounts |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | files.write |
| Grant level | manage |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/mounts/update |
| MCP tool | mounts_update (files) |
| CLI | none |
| Emits | mount.updated |

## Input

```ts
type In = {
  mountId: string;
  mode?: "server_copy" | "live_only";
  reviewChanges?: boolean;
  pullOnly?: boolean;
  name?: string;
};
```

## Output

```ts
type Out = {
  mount: {
    mountId: string;
    folderId: string;
    kind: "google_drive" | "sharepoint" | "onedrive" | "local" | "github";
    provider: string;
    ref?: string;
    name: string;
    state: "idle" | "syncing" | "paused" | "failing" | "device_offline";
    mode: "server_copy" | "live_only";
    reviewChanges: boolean;
    lagSeconds?: number;
    lastSyncAt?: number;
    pendingChanges: number;
    conflicts: number;
    fromDevice?: string;
    error?: string;
  };
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
    "mode": "server_copy",
    "mountId": "mnt_a1b2c3",
    "name": "example",
    "pullOnly": true,
    "reviewChanges": true
  },
  "output": {
    "mount": {
      "conflicts": 1,
      "error": "example",
      "folderId": "fld_a1b2c3",
      "fromDevice": "Irfad's MacBook",
      "kind": "google_drive",
      "lagSeconds": 1,
      "lastSyncAt": 1760000000000,
      "mode": "server_copy",
      "mountId": "mnt_a1b2c3",
      "name": "example",
      "pendingChanges": 1,
      "provider": "Google Drive",
      "ref": "example",
      "reviewChanges": true,
      "state": "idle"
    }
  }
}
```
