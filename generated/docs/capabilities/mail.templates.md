# mail.templates

Email templates: list|get|set|preview|reset; documentId = one document's

| | |
|---|---|
| Module | mail |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | send when actor.kind != 'person' and (input.action == 'set' or input.action == 'reset') |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/mail/templates |
| MCP tool | mail_templates (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  action: "list" | "get" | "set" | "preview" | "reset";
  key?: string;
  documentId?: string;
  subject?: string;
  text?: string;
  recordType?: string;
  recordId?: string;
  vars?: Record<string, unknown>;
};
```

## Output

```ts
type Out = {
  result: unknown;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "action": "list",
    "documentId": "fil_a1b2c3",
    "key": "signature.request",
    "recordId": "rec_a1b2c3",
    "recordType": "contact",
    "subject": "example",
    "text": "example",
    "vars": {}
  },
  "output": {
    "result": {}
  }
}
```
