# email_builder.render

Render desktop, mobile, dark and plain-text previews, optionally as a record

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
| HTTP | POST /v1/email_builder/render |
| MCP tool | email_builder_render (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  emailId: string;
  asRecordId?: string;
  variant: "desktop" | "mobile" | "dark" | "plain";
};
```

## Output

```ts
type Out = {
  html: string;
  warnings: Array<string>;
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
    "asRecordId": "rec_a1b2c3",
    "emailId": "eml_a1b2c3",
    "variant": "desktop"
  },
  "output": {
    "html": "example",
    "warnings": [
      "example"
    ]
  }
}
```
