# skills.policy.set

Console: who may add skills that run scripts or start tool servers (everyone, the default, or only admins)

| | |
|---|---|
| Module | agents |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | agents.manage |
| Grant level | manage |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/skills/policy/set |
| MCP tool | none |
| CLI | none |
| Emits | skill.policy_changed |

## Input

```ts
type In = {
  scriptsAdminOnly: boolean;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  policy: {
    scriptsAdminOnly: boolean;
  };
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
    "idempotencyKey": "idem_1",
    "scriptsAdminOnly": true
  },
  "output": {
    "policy": {
      "scriptsAdminOnly": true
    }
  }
}
```
