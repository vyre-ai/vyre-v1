# skills.grant

Give an agent use, edit or manage of a skill, or take it back (level null). Use puts it in the agent's list; edit lets it save versions; manage lets it share the skill on

| | |
|---|---|
| Module | agents |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | none |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/skills/grant |
| MCP tool | skill_grant (agents) |
| CLI | none |
| Emits | skill.shared |

## Input

```ts
type In = {
  skillId: string;
  agentId: string;
  level: ("use" | "edit" | "manage") | null;
};
```

## Output

```ts
type Out = {
  grants: Array<{
      agentId: string;
      level: "use" | "edit" | "manage";
      by: string;
      at: number;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "agentId": "agt_a1b2c3",
    "level": "use",
    "skillId": "sko_a1b2c3"
  },
  "output": {
    "grants": [
      {
        "agentId": "agt_a1b2c3",
        "at": 1760000000000,
        "by": "example",
        "level": "use"
      }
    ]
  }
}
```
