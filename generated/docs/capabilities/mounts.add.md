# mounts.add

Mount a Google or SharePoint folder, a folder on your computer or a GitHub repository into a folder of the tree; the first sync is a Run

| | |
|---|---|
| Module | mounts |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | files.write |
| Grant level | edit |
| Risk | medium |
| Resource | folder (create under /into) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/mounts/add |
| MCP tool | mounts_add (files) |
| CLI | vyre mounts add |
| Emits | folder.mounted, mount.synced, mount.failed |

## Input

```ts
type In = {
  into: string;
  source: {
    kind: "google_drive" | "sharepoint" | "onedrive" | "local" | "github";
    connectionId?: string;
    ref?: string;
    path?: string;
    branch?: string;
    deviceId?: string;
    localPath?: string;
  };
  name?: string;
  mode?: "server_copy" | "live_only";
  reviewChanges?: boolean;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  mountId: string;
  folderId: string;
  runId: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- provider.auth_failed
- provider.unavailable
- validation.bad_input
- validation.duplicate

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
    "into": "fld_a1b2c3",
    "mode": "server_copy",
    "name": "example",
    "reviewChanges": true,
    "source": {
      "branch": "example",
      "connectionId": "con_a1b2c3",
      "deviceId": "dev_a1b2c3",
      "kind": "google_drive",
      "localPath": "example",
      "path": "example",
      "ref": "example"
    }
  },
  "output": {
    "folderId": "fld_a1b2c3",
    "mountId": "mnt_a1b2c3",
    "runId": "run_a1b2c3"
  }
}
```
