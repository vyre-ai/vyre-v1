# sheets.create

Create a CSV or XLSX table file with a header row

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
| HTTP | POST /v1/sheets/create |
| MCP tool | sheets_create (files) |
| CLI | none |
| Emits | file.created, file.version_added |

## Input

```ts
type In = {
  folderId: string;
  name: string;
  format: "csv" | "xlsx";
  columns: Array<string>;
  sheet?: string;
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
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "columns": [
      "example"
    ],
    "folderId": "fld_a1b2c3",
    "format": "csv",
    "idempotencyKey": "idem_1",
    "name": "example",
    "sheet": "example"
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
