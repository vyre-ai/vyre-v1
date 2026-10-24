# files.folder.move

Move a folder under another folder (its sharing follows the new parent)

| | |
|---|---|
| Module | files |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | files.write |
| Grant level | edit |
| Risk | medium |
| Resource | folder (/folderId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/files/folder/move |
| MCP tool | files_folder_move (files) |
| CLI | none |
| Emits | folder.moved |

## Input

```ts
type In = {
  folderId: string;
  toParentId: string;
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
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "folderId": "fld_a1b2c3",
    "toParentId": "fld_a1b2c3"
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
      }
    }
  }
}
```
