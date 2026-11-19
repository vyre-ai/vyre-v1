# mail.template.for_document.set

Give a document its own email template wording

| | |
|---|---|
| Module | mail |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | comms.templates |
| Grant level | edit |
| Risk | medium |
| Resource | file (/documentId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/mail/template/for_document/set |
| MCP tool | mail_template_for_document_set (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  documentId: string;
  key: string;
  subject: string;
  text: string;
  html?: string;
};
```

## Output

```ts
type Out = {
  template: {
    key: string;
    title: string;
    subject: string;
    text: string;
    html?: string;
    source: "document" | "space" | "builtin";
    recordType?: string;
    version: number;
    updatedAt?: number;
    fields: Array<{
        key: string;
        fallback?: string;
      }>;
  };
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
    "html": "example",
    "key": "signature.request",
    "subject": "example",
    "text": "example"
  },
  "output": {
    "template": {
      "fields": [
        {
          "fallback": "example",
          "key": "example"
        }
      ],
      "html": "example",
      "key": "example",
      "recordType": "contact",
      "source": "document",
      "subject": "example",
      "text": "example",
      "title": "example",
      "updatedAt": 1760000000000,
      "version": 1
    }
  }
}
```
