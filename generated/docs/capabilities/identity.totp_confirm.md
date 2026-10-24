# identity.totp_confirm

Confirm a TOTP enrolment with the first code

| | |
|---|---|
| Module | identity |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/identity/totp_confirm |
| MCP tool | identity_totp_confirm (meta) |
| CLI | none |
| Emits | factor.enrolled |

## Input

```ts
type In = {
  enrolmentId: string;
  code: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
};
```

## Errors

- auth.invalid_code
- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "code": "123456",
    "enrolmentId": "enr_a1b2c3"
  },
  "output": {
    "ok": true
  }
}
```
