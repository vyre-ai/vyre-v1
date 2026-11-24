# documents.make

Make a document for a record from a template

| | |
|---|---|
| Module | documents |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | record (/recordId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/documents/make |
| MCP tool | documents_make (files) |
| CLI | none |
| Emits | document.filled, file.created, file.version_added |

## Input

```ts
type In = {
  template: string;
  recordId: string;
  values?: Record<string, unknown>;
  signingDate?: string;
  name?: string;
  format?: "docx" | "pdf" | "md";
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
  signers?: Array<string>;
  layout?: "word" | "simple";
  converter?: "pulling" | "failed" | "none";
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
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
    "name": "example",
    "recordId": "rec_a1b2c3",
    "signingDate": "2026-10-24",
    "template": "Service agreement",
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
    ]
  }
}
```
