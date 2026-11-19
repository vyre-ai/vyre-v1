# mail.template.save

Save the Space's email template; text may hold {{field}} or {{field|fallback}}

| | |
|---|---|
| Module | mail |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | comms.templates |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/mail/template/save |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  key: string;
  title?: string;
  subject: string;
  text: string;
  html?: string;
  recordType?: string;
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

## Example

```json
{
  "name": "example",
  "input": {
    "html": "example",
    "key": "signature.request",
    "recordType": "contact",
    "subject": "example",
    "text": "example",
    "title": "example"
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
