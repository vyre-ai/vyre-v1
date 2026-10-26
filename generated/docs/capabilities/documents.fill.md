# documents.fill

Fill a template into a new file in a folder; missing required tags stop the fill and are listed

| | |
|---|---|
| Module | documents |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | files.write |
| Grant level | edit |
| Risk | medium |
| Resource | file (create under /intoFolderId) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/documents/fill |
| MCP tool | documents_fill (files) |
| CLI | vyre documents fill |
| Emits | document.filled, file.created, file.version_added |

## Input

```ts
type In = {
  templateFileId: string;
  values?: Record<string, unknown>;
  recordId?: string;
  recordType?: string;
  mapping?: Record<string, string>;
  signingDate?: string;
  intoFolderId: string;
  name?: string;
  format?: "docx" | "pdf";
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  file: {
    fileId: string;
    name: string;
    versionId: string;
  };
  missing: Array<string>;
  unused: Array<string>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "format": "docx",
    "idempotencyKey": "idem_1",
    "intoFolderId": "fld_a1b2c3",
    "mapping": {},
    "name": "example",
    "recordId": "rec_a1b2c3",
    "recordType": "contact",
    "signingDate": "2026-10-24",
    "templateFileId": "fil_a1b2c3",
    "values": {}
  },
  "output": {
    "file": {
      "fileId": "fil_a1b2c3",
      "name": "example",
      "versionId": "ver_a1b2c3"
    },
    "missing": [
      "example"
    ],
    "unused": [
      "example"
    ]
  }
}
```
