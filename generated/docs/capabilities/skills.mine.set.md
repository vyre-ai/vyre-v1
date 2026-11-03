# skills.mine.set

Switch one of your skills (or one shared with you) on or off, pick the agents that use it, or give its tool servers their Vault keys

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
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/skills/mine/set |
| MCP tool | skills_mine_set (agents) |
| CLI | none |
| Emits | skill.mine_changed |

## Input

```ts
type In = {
  skillId: string;
  enabled?: boolean;
  agents?: Array<string>;
  setup?: Record<string, string>;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  skillId: string;
  enabled: boolean;
  agents: Array<string>;
  setup: Record<string, string>;
  needs: Array<string>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "agents": [
      "example"
    ],
    "enabled": true,
    "idempotencyKey": "idem_1",
    "setup": {},
    "skillId": "sko_a1b2c3"
  },
  "output": {
    "agents": [
      "example"
    ],
    "enabled": true,
    "needs": [
      "example"
    ],
    "setup": {},
    "skillId": "sko_a1b2c3"
  }
}
```
