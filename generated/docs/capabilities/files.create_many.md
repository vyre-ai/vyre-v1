# files.create_many

Up to 200 files in one folder in one call, all or none; each as files.create takes it

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
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/files/create_many |
| MCP tool | files_create_many (files) |
| CLI | none |
| Emits | file.created, file.version_added |

## Input

```ts
type In = {
  folderId: string;
  files: Array<{
      name: string;
      content?: {
        text?: string;
        base64?: string;
        blobId?: string;
      };
    }>;
  idempotencyKey: string;
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
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.duplicate
- validation.precondition_failed
- validation.too_large

## Example

```json
{
  "name": "example",
  "input": {
    "files": [
      {
        "content": {
          "base64": "example",
          "blobId": "blb_a1b2c3",
          "text": "example"
        },
        "name": "example"
      }
    ],
    "folderId": "fld_a1b2c3",
    "idempotencyKey": "idem_1"
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
    ]
  }
}
```
