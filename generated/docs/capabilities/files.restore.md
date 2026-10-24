# files.restore

Bring a file back from Trash

| | |
|---|---|
| Module | files |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | files.delete |
| Grant level | edit |
| Risk | medium |
| Resource | file (/fileId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/files/restore |
| MCP tool | files_restore (files) |
| CLI | none |
| Emits | file.restored |

## Input

```ts
type In = {
  fileId: string;
  toFolderId?: string;
};
```

## Output

```ts
type Out = {
  file: {
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
    "fileId": "fil_a1b2c3",
    "toFolderId": "fld_a1b2c3"
  },
  "output": {
    "file": {
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
  }
}
```
