# mail.template.preview

Fill a template (a saved key, or a draft subject and text) from a real record and values you pass; says which fields would go out blank

| | |
|---|---|
| Module | mail |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/mail/template/preview |
| MCP tool | mail_template_preview (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  key?: string;
  documentId?: string;
  subject?: string;
  text?: string;
  html?: string;
  recordId?: string;
  vars?: Record<string, unknown>;
};
```

## Output

```ts
type Out = {
  subject: string;
  text: string;
  html?: string;
  source: "document" | "space" | "builtin" | "draft";
  blanks: Array<string>;
  fallbacks: Array<string>;
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
    "documentId": "fil_a1b2c3",
    "html": "example",
    "key": "signature.request",
    "recordId": "rec_a1b2c3",
    "subject": "example",
    "text": "example",
    "vars": {}
  },
  "output": {
    "blanks": [
      "example"
    ],
    "fallbacks": [
      "example"
    ],
    "html": "example",
    "source": "document",
    "subject": "example",
    "text": "example"
  }
}
```
