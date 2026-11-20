# mail.template.for_document.clear

Return a document to the Space's template

| | |
|---|---|
| Module | mail |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | comms.templates |
| Grant level | edit |
| Risk | medium |
| Resource | file (/documentId) |
| Gate | send when actor.kind != 'person' |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/mail/template/for_document/clear |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  documentId: string;
  key: string;
};
```

## Output

```ts
type Out = {
  cleared: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "documentId": "fil_a1b2c3",
    "key": "signature.request"
  },
  "output": {
    "cleared": true
  }
}
```
