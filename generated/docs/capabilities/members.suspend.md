# members.suspend

Suspend a person: they cannot act and their devices purge on next contact

| | |
|---|---|
| Module | members |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | members.remove |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/members/suspend |
| MCP tool | members_suspend (meta) |
| CLI | none |
| Emits | principal.suspended |

## Input

```ts
type In = {
  personId: string;
  reason?: string;
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
    "personId": "usr_a1b2c3",
    "reason": "example"
  },
  "output": {
    "ok": true
  }
}
```
