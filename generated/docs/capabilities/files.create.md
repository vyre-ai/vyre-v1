# files.create

Create a file in a folder from text, base64 or an uploaded blob

| | |
|---|---|
| Module | files |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | files.write |
| Grant level | edit |
| Risk | medium |
| Resource | folder (create under /folderId) |
| Gate | none |
| Idempotency | key |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/files/create |
| MCP tool | files_create (files) |
| CLI | vyre files put |
| Emits | file.created, file.version_added, changeset.opened |

## Input

```ts
type In = {
  folderId: string;
  name: string;
  content?: {
    text?: string;
    base64?: string;
    blobId?: string;
  };
  mime?: string;
  kind?: "text" | "markdown" | "document" | "spreadsheet" | "presentation" | "pdf" | "image" | "video" | "audio" | "code" | "archive" | "google_native" | "other";
  idempotencyKey: string;
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
    starred?: boolean;
    conflict?: boolean;
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
- validation.too_large

## Example

```json
{
  "name": "example",
  "input": {
    "content": {
      "base64": "example",
      "blobId": "blb_a1b2c3",
      "text": "example"
    },
    "folderId": "fld_a1b2c3",
    "idempotencyKey": "idem_1",
    "kind": "text",
    "mime": "example",
    "name": "example"
  },
  "output": {
    "changesetId": "chg_a1b2c3",
    "file": {
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
  }
}
```
