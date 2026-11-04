# skills.grants

Who owns a skill and which agents hold it, at what level

| | |
|---|---|
| Module | agents |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/skills/grants |
| MCP tool | skill_grants (agents) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  skillId: string;
};
```

## Output

```ts
type Out = {
  owner: string;
  ownerKind: "person" | "agent";
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
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
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
    ],
    "owner": "example",
    "ownerKind": "person"
  }
}
```
