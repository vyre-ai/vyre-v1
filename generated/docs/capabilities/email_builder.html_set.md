# email_builder.html_set

Set full HTML (an agent can write it and place it)

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
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/email_builder/html_set |
| MCP tool | email_builder_html_set (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  emailId: string;
  html: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
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
    "emailId": "eml_a1b2c3",
    "html": "example"
  },
  "output": {
    "ok": true
  }
}
```
