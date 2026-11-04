# settings.contact.verify_start

Send a 6-digit code to my email or phone through the Space mail sender or its phone line; it lasts 10 minutes, 3 an hour

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
| HTTP | POST /v1/settings/contact/verify_start |
| MCP tool | settings_contact_verify_start (meta) |
| CLI | none |
| Emits | settings.contact_code_sent |

## Input

```ts
type In = {
  channel: "email" | "phone";
};
```

## Output

```ts
type Out = {
  sent: boolean;
  verified: boolean;
  expiresAt: number;
};
```

## Errors

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
    "channel": "email"
  },
  "output": {
    "expiresAt": 1,
    "sent": true,
    "verified": true
  }
}
```
