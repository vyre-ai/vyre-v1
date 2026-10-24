# members.sso.test

Test an SSO provider: discovery document, keys and redirect

| | |
|---|---|
| Module | members |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | policy.manage |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /v1/members/sso/test |
| MCP tool | members_sso_test (engineer) |
| CLI | none |
| Emits | none |

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
  detail?: string;
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
    "detail": "example",
    "ok": true
  }
}
```
