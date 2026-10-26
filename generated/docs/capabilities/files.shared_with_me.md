# files.shared_with_me

Files and folders other people shared with the caller, newest share first (the Shared with me section of the tree)

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
| HTTP | POST /v1/files/shared_with_me |
| MCP tool | files_shared_with_me (files) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  kind?: "text" | "markdown" | "document" | "spreadsheet" | "presentation" | "pdf" | "image" | "video" | "audio" | "code" | "archive" | "google_native" | "other";
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
      starred?: boolean;
      conflict?: boolean;
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
      subject?: {
        kind: "agent" | "project" | "space";
        id?: string;
      };
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
    "kind": "text",
    "limit": 1
  },
  "output": {
    "files": [
      {
        "conflict": true,
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
        "starred": true,
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
        },
        "subject": {
          "id": "agt_a1b2c3",
          "kind": "agent"
        }
      }
    ],
    "next": "example",
    "total": 1
  }
}
```
