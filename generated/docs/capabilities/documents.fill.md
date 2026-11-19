# documents.fill

Fill a template into a new file in a folder; missing required fields stop the fill and are listed

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
  mapping?: Record<string, string>;
  signingDate?: string;
  intoFolderId: string;
  name?: string;
  format?: "docx" | "pdf" | "md" | {"description":"A Word template fills to docx or pdf; a Vyre document fills to pdf, or to md to go on editing"};
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
  signers?: Array<string>;
  layout?: "word" | "simple" | {"description":"word: the Word page kept; simple: plain page look, a preview"};
  converter?: "pulling" | "failed" | "none" | {"description":"Why a copy is plain: the exact converter is being fetched, failed, or this machine has no engine"};
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
- validation.unsupported

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
    "signingDate": "2026-10-24",
    "templateFileId": "fil_a1b2c3",
    "values": {}
  },
  "output": {
    "converter": "pulling",
    "file": {
      "fileId": "fil_a1b2c3",
      "name": "example",
      "versionId": "ver_a1b2c3"
    },
    "layout": "word",
    "missing": [
      "example"
    ],
    "signers": [
      "example"
    ],
    "unused": [
      "example"
    ]
  }
}
```
