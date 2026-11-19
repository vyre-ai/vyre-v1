# mail.template.get

Read an email template (a document's own wording with documentId)

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
| HTTP | POST /v1/mail/template/get |
| MCP tool | mail_template_get (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  key: string;
  documentId?: string;
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
