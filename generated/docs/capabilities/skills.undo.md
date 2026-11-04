# skills.undo

Undo the latest version of a skill; the version before it comes back as a new version, and undoing again brings the undone one back

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
| HTTP | POST /v1/skills/undo |
| MCP tool | skill_undo (agents) |
| CLI | none |
| Emits | skill.mine_changed |

## Input

```ts
type In = {
  skillId: string;
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
  undid: number;
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
    "skillId": "sko_a1b2c3"
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
    },
    "undid": 1
  }
}
```
