# mounts.list

List mounts the caller can see

| | |
|---|---|
| Module | mounts |
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
| HTTP | POST /v1/mounts/list |
| MCP tool | mounts_list (files) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  kind?: "google_drive" | "sharepoint" | "onedrive" | "local" | "github";
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  mounts: Array<{
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
    }>;
  next?: string;
  total?: number;
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
    "cursor": "example",
    "kind": "google_drive",
    "limit": 1
  },
  "output": {
    "mounts": [
      {
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
    ],
    "next": "example",
    "total": 1
  }
}
```
