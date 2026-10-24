# identity.totp_begin

Start a TOTP enrolment; returns the shared secret once as a setup URI

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
| HTTP | POST /v1/identity/totp_begin |
| MCP tool | identity_totp_begin (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  setupUri: string;
  enrolmentId: string;
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
  "input": {},
  "output": {
    "enrolmentId": "enr_a1b2c3",
    "setupUri": "otpauth://totp/Vyre:maya?secret=ABC"
  }
}
```
