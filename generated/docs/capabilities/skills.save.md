# skills.save

Write a skill as its owner (the person, or an agent they own; an agent writes its own) or as an agent given edit: a new skill, or a new version of one. Every save is a version

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
| HTTP | POST /v1/skills/save |
| MCP tool | skill_save (agents) |
| CLI | none |
| Emits | skill.mine_changed |

## Input

```ts
type In = {
  text: string;
  files?: Record<string, string>;
  skillId?: string;
  ownerAgentId?: string;
  source?: string;
  summary?: string;
};
```

## Output

```ts
type Out = {
  skill: {
    skillId: string;
    name: string;
    description: string;
    owner: string;
    ownerKind: "person" | "agent";
    rev: number;
    version: string;
    updatedAt: number;
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
- validation.too_large

## Example

```json
{
  "name": "example",
  "input": {
    "files": {},
    "ownerAgentId": "agt_a1b2c3",
    "skillId": "sko_a1b2c3",
    "source": "example",
    "summary": "example",
    "text": "example"
  },
  "output": {
    "skill": {
      "description": "example",
      "name": "example",
      "owner": "example",
      "ownerKind": "person",
      "rev": 1,
      "skillId": "sko_a1b2c3",
      "updatedAt": 1760000000000,
      "version": "example"
    }
  }
}
```
