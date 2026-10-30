# skills.add

Add or replace a skill in the Space library, or in one agent (SKILL.md text with name and description in its front matter, plus optional supporting files)

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
| HTTP | POST /v1/skills/add |
| MCP tool | skills_add (agents) |
| CLI | none |
| Emits | skill.added |

## Input

```ts
type In = {
  text: string;
  name?: string;
  agentId?: string;
  source?: string;
  files?: Record<string, string>;
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
- validation.too_large

## Example

```json
{
  "name": "example",
  "input": {
    "agentId": "agt_a1b2c3",
    "files": {},
    "idempotencyKey": "idem_1",
    "name": "example",
    "source": "example",
    "text": "example"
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
