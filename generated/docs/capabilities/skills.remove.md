# skills.remove

Remove a skill from the Space library, or from one agent

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
| HTTP | POST /v1/skills/remove |
| MCP tool | skills_remove (agents) |
| CLI | none |
| Emits | skill.removed |

## Input

```ts
type In = {
  name: string;
  agentId?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  removed: boolean;
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
    "idempotencyKey": "idem_1",
    "name": "example"
  },
  "output": {
    "removed": true
  }
}
```
