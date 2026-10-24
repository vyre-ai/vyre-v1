# documents.mark_template

Mark a docx file as a template, or unmark it

| | |
|---|---|
| Module | documents |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | files.write |
| Grant level | edit |
| Risk | medium |
| Resource | file (/fileId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/documents/mark_template |
| MCP tool | documents_mark_template (files) |
| CLI | none |
| Emits | document.template_marked |

## Input

```ts
type In = {
  fileId: string;
  isTemplate: boolean;
};
```

## Output

```ts
type Out = {
  ok: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found
- validation.unsupported

## Example

```json
{
  "name": "example",
  "input": {
    "fileId": "fil_a1b2c3",
    "isTemplate": true
  },
  "output": {
    "ok": true
  }
}
```
