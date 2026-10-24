# agents.template.apply

Apply the template: adds, never removes or overwrites; changed files become suggestions; widening ones need admin approval; try one agent first

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
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/agents/template/apply |
| MCP tool | agents_template_apply (agents) |
| CLI | none |
| Emits | agent.template_applied |

## Input

```ts
type In = {
  scope: "all" | "one";
  agentId?: string;
};
```

## Output

```ts
type Out = {
  applied: number;
  suggestions: number;
  taskId?: string;
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
    "agentId": "agt_a1b2c3",
    "scope": "all"
  },
  "output": {
    "applied": 1,
    "suggestions": 1,
    "taskId": "tsk_a1b2c3"
  }
}
```
