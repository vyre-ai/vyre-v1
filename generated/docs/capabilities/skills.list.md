# skills.list

Skills a chat with this agent can load: Vyre built-in, the Space library and the agent own skills/ folder, one line each. With no agentId, the Space library and built-in ones

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
| HTTP | POST /v1/skills/list |
| MCP tool | skills_list (agents) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  agentId?: string;
  includeOff?: boolean;
};
```

## Output

```ts
type Out = {
  skills: Array<{
      name: string;
      description: string;
      tier: "builtin" | "space" | "agent";
      source: string;
      agentId?: string;
      system: boolean;
      enabled: boolean;
      bytes: number;
      updatedAt?: number;
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
  "input": {
    "agentId": "agt_a1b2c3",
    "includeOff": true
  },
  "output": {
    "skills": [
      {
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
    ]
  }
}
```
