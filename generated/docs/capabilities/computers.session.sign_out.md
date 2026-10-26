# computers.session.sign_out

Sign out of a site on the profile disk

| | |
|---|---|
| Module | computers |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | computers.take_over |
| Grant level | edit |
| Risk | medium |
| Resource | computer (/computerId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | sensitive |
| Team Space only | yes |
| HTTP | POST /v1/computers/session/sign_out |
| MCP tool | computers_session_sign_out (computer) |
| CLI | none |
| Emits | computer.session_signed_out, computer.started |

## Input

```ts
type In = {
  computerId: string;
  site: string;
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
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "computerId": "cmt_a1b2c3",
    "site": "example"
  },
  "output": {
    "ok": true
  }
}
```
