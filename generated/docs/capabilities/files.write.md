# files.write

Replace the content of a file. In a Review changes folder an agent write lands in a changeset and syncs only on Approve

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
| HTTP | POST /v1/files/write |
| MCP tool | files_write (files) |
| CLI | none |
| Emits | file.version_added, file.conflict_kept, changeset.opened, changeset.updated |

## Input

```ts
type In = {
  fileId: string;
  content: {
    text?: string;
    base64?: string;
    blobId?: string;
  };
  baseVersion?: number;
  reason?: string;
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
  versionId?: string;
  changesetId?: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.on_hold
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found
- validation.too_large
- validation.version_conflict

## Example

```json
{
  "name": "example",
  "input": {
    "baseVersion": 1,
    "content": {
      "base64": "example",
      "blobId": "blb_a1b2c3",
      "text": "example"
    },
    "fileId": "fil_a1b2c3",
    "reason": "example"
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
    },
    "versionId": "ver_a1b2c3"
  }
}
```
