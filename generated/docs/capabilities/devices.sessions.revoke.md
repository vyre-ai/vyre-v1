# devices.sessions.revoke

End one session

| | |
|---|---|
| Module | devices |
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
| HTTP | POST /v1/devices/sessions/revoke |
| MCP tool | devices_sessions_revoke (meta) |
| CLI | none |
| Emits | session.revoked |

## Input

```ts
type In = {
  sessionId: string;
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
