# skills.of_agents

The skills the agents a person owns keep for themselves, one row each

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
| HTTP | POST /v1/skills/of_agents |
| MCP tool | skills_of_agents (agents) |
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
      skillId: string;
      name: string;
      description: string;
      agentId: string;
      agentName: string;
      version: string;
      source: string;
      rev: number;
      updatedAt: number;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {},
  "output": {
    "skills": [
      {
        "agentId": "agt_a1b2c3",
        "agentName": "example",
        "description": "example",
        "name": "example",
        "rev": 1,
        "skillId": "sko_a1b2c3",
        "source": "example",
        "updatedAt": 1760000000000,
        "version": "example"
      }
    ]
  }
}
```
