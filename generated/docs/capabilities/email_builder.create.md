# email_builder.create

Create an email design

| | |
|---|---|
| Module | email-builder-api |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | email (create under /folderId) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/email_builder/create |
| MCP tool | email_builder_create (inbox) |
| CLI | none |
| Emits | email.created |

## Input

```ts
type In = {
  name: string;
  mode: "blocks" | "html" | "plain";
  folderId?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  email: {
    emailId: string;
    name: string;
    mode: "blocks" | "html" | "plain";
    blocks?: Array<{
        type: "text" | "heading" | "image" | "button" | "columns" | "divider" | "merge" | "footer" | "html" | "spacer" | "social" | "saved";
        props: Record<string, unknown>;
      }>;
    html?: string;
    plain?: string;
    subject?: string;
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "folderId": "fld_a1b2c3",
    "idempotencyKey": "idem_1",
    "mode": "blocks",
    "name": "example"
  },
  "output": {
    "email": {
      "blocks": [
        {
          "props": {},
          "type": "text"
        }
      ],
      "emailId": "eml_a1b2c3",
      "html": "example",
      "mode": "blocks",
      "name": "example",
      "plain": "example",
      "subject": "example"
    }
  }
}
```
