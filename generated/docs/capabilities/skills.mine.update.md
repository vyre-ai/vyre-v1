# skills.mine.update

Fetch one of your skills again from its link or repo; whoever it is shared with approves again if it can now touch more

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
| HTTP | POST /v1/skills/mine/update |
| MCP tool | skills_mine_update (agents) |
| CLI | none |
| Emits | skill.mine_changed |

## Input

```ts
type In = {
  skillId: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  skill: {
    skillId: string;
    name: string;
    label?: string;
    description: string;
    source: string;
    origin: string;
    version?: string;
    projectId?: string;
    agents: Array<string>;
    enabled: boolean;
    perms: {
      scripts: Array<string>;
      mcpServers: Array<{
          name: string;
          transport: "stdio" | "http" | "sse" | "ws";
          target: string;
          keys: Array<string>;
        }>;
      network: Array<string>;
      vaultKeys: Array<string>;
    };
    setup: Record<string, string>;
    needs: Array<string>;
    sharedWith: Array<string>;
    updatedAt: number;
  };
  changed: boolean;
  growth: Array<string>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- provider.unavailable
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
    "skillId": "sko_a1b2c3"
  },
  "output": {
    "changed": true,
    "growth": [
      "example"
    ],
    "skill": {
      "agents": [
        "example"
      ],
      "description": "example",
      "enabled": true,
      "label": "example",
      "name": "example",
      "needs": [
        "example"
      ],
      "origin": "example",
      "perms": {
        "mcpServers": [
          {
            "keys": [
              "example"
            ],
            "name": "example",
            "target": "example",
            "transport": "stdio"
          }
        ],
        "network": [
          "example"
        ],
        "scripts": [
          "example"
        ],
        "vaultKeys": [
          "example"
        ]
      },
      "projectId": "prj_a1b2c3",
      "setup": {},
      "sharedWith": [
        "example"
      ],
      "skillId": "sko_a1b2c3",
      "source": "example",
      "updatedAt": 1760000000000,
      "version": "example"
    }
  }
}
```
