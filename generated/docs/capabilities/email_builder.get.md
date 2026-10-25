# email_builder.get

Read an email design

| | |
|---|---|
| Module | email-builder-api |
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
| HTTP | POST /v1/email_builder/get |
| MCP tool | email_builder_get (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  emailId: string;
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
    "emailId": "eml_a1b2c3"
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
