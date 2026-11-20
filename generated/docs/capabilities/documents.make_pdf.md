# documents.make_pdf

Make a PDF of a Vyre document (.md) in a folder; a blank still in its text stops it and is named

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
| HTTP | POST /v1/documents/make_pdf |
| MCP tool | none |
| CLI | none |
| Emits | file.created, file.version_added |

## Input

```ts
type In = {
  fileId: string;
  intoFolderId: string;
  name?: string;
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
  pages: number;
  signers?: Array<string>;
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
    "fileId": "fil_a1b2c3",
    "idempotencyKey": "idem_1",
    "intoFolderId": "fld_a1b2c3",
    "name": "example"
  },
  "output": {
    "file": {
      "fileId": "fil_a1b2c3",
      "name": "example",
      "versionId": "ver_a1b2c3"
    },
    "pages": 1,
    "signers": [
      "example"
    ]
  }
}
```
