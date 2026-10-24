# files.folder.search

Find folders by name for the # picker and the Into picker

| | |
|---|---|
| Module | files |
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
| HTTP | POST /v1/files/folder/search |
| MCP tool | files_folder_search (files) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  q: string;
  scope?: "folders" | "channels" | "all";
  limit?: number;
};
```

## Output

```ts
type Out = {
  folders: Array<{
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
    }>;
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
    "limit": 1,
    "q": "example",
    "scope": "folders"
  },
  "output": {
    "folders": [
      {
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
    ]
  }
}
```
