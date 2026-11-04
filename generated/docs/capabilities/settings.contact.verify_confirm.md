# settings.contact.verify_confirm

Confirm the code that was sent; the tick shows only after this

| | |
|---|---|
| Module | settings |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/settings/contact/verify_confirm |
| MCP tool | settings_contact_verify_confirm (meta) |
| CLI | none |
| Emits | settings.contact_verified, settings.contact_code_failed |

## Input

```ts
type In = {
  channel: "email" | "phone";
  code: string;
};
```

## Output

```ts
type Out = {
  verified: boolean;
};
```

## Errors

- auth.expired
- auth.invalid_code
- internal.unexpected
- permission.above_clearance
- permission.no_grant
- rate_limit.exceeded
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "channel": "email",
    "code": "example"
  },
  "output": {
    "verified": true
  }
}
```
