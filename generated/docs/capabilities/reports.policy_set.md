# reports.policy_set

Set the policy to On, Ask or Off; what is captured never changes, only the destination

| | |
|---|---|
| Module | reports-client |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | policy.manage |
| Grant level | manage |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/reports/policy_set |
| MCP tool | reports_policy_set (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  policy: "on" | "ask" | "off";
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
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "policy": "on"
  },
  "output": {
    "ok": true
  }
}
```
