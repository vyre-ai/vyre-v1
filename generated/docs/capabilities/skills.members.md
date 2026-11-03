# skills.members

Console: the skills each member keeps for themselves, by name only; contents only of the ones they shared

| | |
|---|---|
| Module | agents |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | agents.manage |
| Grant level | manage |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/skills/members |
| MCP tool | skills_members (agents) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  skills: Array<{
      owner: string;
      ownerName: string;
      name: string;
      shared: boolean;
      skillId?: string;
      toSpace: boolean;
    }>;
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
  "input": {},
  "output": {
    "skills": [
      {
        "name": "example",
        "owner": "example",
        "ownerName": "example",
        "shared": true,
        "skillId": "sko_a1b2c3",
        "toSpace": true
      }
    ]
  }
}
```
