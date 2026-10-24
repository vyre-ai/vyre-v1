# access.actors.revoke

Revoke the token of an outside actor in one click

| | |
|---|---|
| Module | access |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | access.manage |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/access/actors/revoke |
| MCP tool | access_actors_revoke (engineer) |
| CLI | none |
| Emits | token.revoked, access.changed |

## Input

```ts
type In = {
  actorId: string;
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
    "actorId": "act_a1b2c3"
  },
  "output": {
    "ok": true
  }
}
```
