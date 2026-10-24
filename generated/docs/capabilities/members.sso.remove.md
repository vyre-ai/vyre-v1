# members.sso.remove

Remove an SSO provider

| | |
|---|---|
| Module | members |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | policy.manage |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/members/sso/remove |
| MCP tool | members_sso_remove (engineer) |
| CLI | none |
| Emits | policy.changed |

## Input

```ts
type In = {
  key: "google" | "microsoft" | "okta";
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
    "key": "google"
  },
  "output": {
    "ok": true
  }
}
```
