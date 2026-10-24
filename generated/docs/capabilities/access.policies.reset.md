# access.policies.reset

Reset a policy to its default

| | |
|---|---|
| Module | access |
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
| HTTP | POST /v1/access/policies/reset |
| MCP tool | access_policies_reset (engineer) |
| CLI | none |
| Emits | policy.changed |

## Input

```ts
type In = {
  key: string;
  scope: string;
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
    "key": "example",
    "scope": "space"
  },
  "output": {
    "ok": true
  }
}
```
