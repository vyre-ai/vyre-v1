# files.folder.settings

Change Review changes, sensitivity label or the working-folder flags of a folder

| | |
|---|---|
| Module | files |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | files.write |
| Grant level | manage |
| Risk | medium |
| Resource | folder (/folderId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/files/folder/settings |
| MCP tool | files_folder_settings (files) |
| CLI | none |
| Emits | folder.settings_changed |

## Input

```ts
type In = {
  folderId: string;
  reviewChanges?: boolean;
  label?: "public" | "internal" | "confidential" | "restricted";
};
```

## Output

```ts
type Out = {
  folder: {
    folderId: string;
    parentId?: string;
    name: string;
    path: string;
    fileCount: number;
    folderCount: number;
    scope: "personal" | "space";
    label: number;
    source?: {
      mountId: string;
      provider: string;
    };
    git: boolean;
    reviewChanges: boolean;
    subject?: {
      kind: "agent" | "project" | "space";
      id?: string;
    };
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "folderId": "fld_a1b2c3",
    "label": "public",
    "reviewChanges": true
  },
  "output": {
    "folder": {
      "fileCount": 1,
      "folderCount": 1,
      "folderId": "fld_a1b2c3",
      "git": true,
      "label": 1,
      "name": "example",
      "parentId": "fld_a1b2c3",
      "path": "Projects/Probate GTM",
      "reviewChanges": true,
      "scope": "personal",
      "source": {
        "mountId": "mnt_a1b2c3",
        "provider": "example"
      },
      "subject": {
        "id": "agt_a1b2c3",
        "kind": "agent"
      }
    }
  }
}
```
