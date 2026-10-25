# files.move

Move a file to another folder (grants of the new folder apply, nothing is copied)

| | |
|---|---|
| Module | files |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | files.write |
| Grant level | edit |
| Risk | medium |
| Resource | file (/fileId) |
| Gate | none |
| Idempotency | natural |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/files/move |
| MCP tool | files_move (files) |
| CLI | none |
| Emits | file.moved, file.renamed, changeset.opened, changeset.updated |

## Input

```ts
type In = {
  fileId: string;
  toFolderId: string;
  name?: string;
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
  changesetId?: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.duplicate
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "fileId": "fil_a1b2c3",
    "name": "example",
    "toFolderId": "fld_a1b2c3"
  },
  "output": {
    "changesetId": "chg_a1b2c3",
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
