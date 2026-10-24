# email_builder.send_test

Send a test email to the author

| | |
|---|---|
| Module | email-builder-api |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | grant only |
| Grant level | use |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/email_builder/send_test |
| MCP tool | email_builder_send_test (inbox) |
| CLI | none |
| Emits | email_template.test_sent |

## Input

```ts
type In = {
  emailId: string;
  to: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  sent: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.network
- provider.unavailable
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "emailId": "eml_a1b2c3",
    "idempotencyKey": "idem_1",
    "to": "example"
  },
  "output": {
    "sent": true
  }
}
```
