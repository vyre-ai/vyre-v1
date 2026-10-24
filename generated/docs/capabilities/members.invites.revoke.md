# members.invites.revoke

Revoke an open invite

| | |
|---|---|
| Module | members |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | members.invite |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/members/invites/revoke |
| MCP tool | members_invites_revoke (meta) |
| CLI | none |
| Emits | member.invite_revoked |

## Input

```ts
type In = {
  inviteId: string;
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

## Example

```json
{
  "name": "example",
  "input": {
    "inviteId": "inv_a1b2c3"
  },
  "output": {
    "ok": true
  }
}
```
