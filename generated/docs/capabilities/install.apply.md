# install.apply

Install what a plan says, for the person, for one agent, or for everyone in the Space (admin only). An agent asking is held at the Gate as a card with the plan; the person presses Install

| | |
|---|---|
| Module | agents |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | high |
| Resource | space |
| Gate | install |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/install/apply |
| MCP tool | install_apply (agents) |
| CLI | none |
| Emits | skill.mine_changed, skill.added, plugin.installed, plugin.changed |

## Input

```ts
type In = {
  planId: string;
  for: "me" | "agent" | "space";
  agentId?: string;
  runOn?: "sandbox" | "space";
  authHandle?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  installed: Record<string, unknown>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "agentId": "agt_a1b2c3",
    "authHandle": "#Dana_Lawmatics",
    "for": "me",
    "idempotencyKey": "idem_1",
    "planId": "ins_a1b2c3",
    "runOn": "sandbox"
  },
  "output": {
    "installed": {}
  }
}
```
