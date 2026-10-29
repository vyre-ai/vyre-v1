# skills.set_enabled

Turn a Space or agent skill off or on without removing it

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
| HTTP | POST /v1/skills/set_enabled |
| MCP tool | skills_set_enabled (agents) |
| CLI | none |
| Emits | skill.changed |

## Input

```ts
type In = {
  name: string;
  agentId?: string;
  enabled: boolean;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  skill: {
    name: string;
    description: string;
    tier: "builtin" | "space" | "agent";
    source: string;
    agentId?: string;
    system: boolean;
    enabled: boolean;
    bytes: number;
    updatedAt?: number;
  };
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
    "enabled": true,
    "idempotencyKey": "idem_1",
    "name": "example"
  },
  "output": {
    "skill": {
      "agentId": "agt_a1b2c3",
      "bytes": 1,
      "description": "example",
      "enabled": true,
      "name": "deploy-checks",
      "source": "upload",
      "system": true,
      "tier": "builtin",
      "updatedAt": 1760000000000
    }
  }
}
```
