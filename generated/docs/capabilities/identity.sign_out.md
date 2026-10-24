# identity.sign_out

End this session; the device keeps nothing it should not

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
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/identity/sign_out |
| MCP tool | identity_sign_out (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  sessionId?: string;
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
    "sessionId": "ses_a1b2c3"
  },
  "output": {
    "ok": true
  }
}
```
