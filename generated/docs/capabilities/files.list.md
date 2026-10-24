# files.list

List files and folders in a folder or a section (Personal, Shared with me, Space)

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
| HTTP | POST /v1/files/list |
| MCP tool | files_list (files) |
| CLI | vyre files ls |
| Emits | none |

## Input

```ts
type In = {
  section?: "personal" | "shared" | "space";
  folder?: string;
  kind?: "text" | "markdown" | "document" | "spreadsheet" | "presentation" | "pdf" | "image" | "video" | "audio" | "code" | "archive" | "google_native" | "other";
  sort?: "name" | "updated" | "size" | "kind";
  dir?: "asc" | "desc";
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  files: Array<{
      fileId: string;
      folderId: string;
      name: string;
      kind: "text" | "markdown" | "document" | "spreadsheet" | "presentation" | "pdf" | "image" | "video" | "audio" | "code" | "archive" | "google_native" | "other";
      mime: string;
      size: number;
      version: number;
      label: number;
      ownerId: string;
      createdAt: number;
      updatedAt: number;
      updatedBy: string;
      source?: {
        mountId: string;
        provider: string;
      };
      deletedAt?: number;
      thumb: boolean;
      holds: number;
    }>;
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
    "dir": "asc",
    "folder": "fld_a1b2c3",
    "kind": "text",
    "limit": 1,
    "section": "personal",
    "sort": "name"
  },
  "output": {
    "files": [
      {
        "createdAt": 1760000000000,
        "deletedAt": 1760000000000,
        "fileId": "fil_a1b2c3",
        "folderId": "fld_a1b2c3",
        "holds": 1,
        "kind": "text",
        "label": 1,
        "mime": "example",
        "name": "example",
        "ownerId": "example",
        "size": 1,
        "source": {
          "mountId": "mnt_a1b2c3",
          "provider": "example"
        },
        "thumb": true,
        "updatedAt": 1760000000000,
        "updatedBy": "example",
        "version": 1
      }
    ],
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
    ],
    "next": "example",
    "total": 1
  }
}
```
