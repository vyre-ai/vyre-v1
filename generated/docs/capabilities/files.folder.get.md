# files.folder.get

Read one folder with counts, source mark, git state and Review changes flag

| | |
|---|---|
| Module | files |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | folder (/folderId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/files/folder/get |
| MCP tool | files_folder_get (files) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  folderId: string;
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
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "folderId": "fld_a1b2c3"
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
