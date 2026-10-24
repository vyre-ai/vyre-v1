# identity.reset_start

Admin: start a password reset and get a one-time link for the person (valid 24 hours); their other devices are signed out

| | |
|---|---|
| Module | identity |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | access.manage |
| Grant level | view |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/identity/reset_start |
| MCP tool | identity_reset_start (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  personId: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  resetCode: string;
  expiresAt: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
    "personId": "usr_a1b2c3"
  },
  "output": {
    "expiresAt": 1760000000000,
    "resetCode": "example"
  }
}
```
