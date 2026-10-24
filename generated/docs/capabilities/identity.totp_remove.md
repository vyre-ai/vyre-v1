# identity.totp_remove

Remove my TOTP factor (refused when the Space requires a second factor)

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
| HTTP | POST /v1/identity/totp_remove |
| MCP tool | identity_totp_remove (meta) |
| CLI | none |
| Emits | factor.removed |

## Input

```ts
type In = {
  password: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
};
```

## Errors

- auth.bad_credentials
- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "password": "example"
  },
  "output": {
    "ok": true
  }
}
```
