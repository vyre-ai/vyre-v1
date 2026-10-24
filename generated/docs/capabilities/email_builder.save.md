# email_builder.save

Autosave a design; each save is a version

| | |
|---|---|
| Module | email-builder-api |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/email_builder/save |
| MCP tool | email_builder_save (inbox) |
| CLI | none |
| Emits | email_template.saved |

## Input

```ts
type In = {
  emailId: string;
  email: {
    emailId: string;
    name: string;
    mode: "blocks" | "html" | "plain";
    blocks?: Array<{
        type: "text" | "image" | "button" | "columns" | "divider" | "merge" | "html";
        props: Record<string, unknown>;
      }>;
    html?: string;
    plain?: string;
    subject?: string;
  };
};
```

## Output

```ts
type Out = {
  version: number;
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
    },
    "emailId": "eml_a1b2c3"
  },
  "output": {
    "version": 1
  }
}
```
