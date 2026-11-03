# skills.mine.add

Add a skill for yourself and your agents (Mine), or replace one of yours. A name already taken is kept, and this one is renamed with its source

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
| HTTP | POST /v1/skills/mine/add |
| MCP tool | skills_mine_add (agents) |
| CLI | none |
| Emits | skill.mine_changed |

## Input

```ts
type In = {
  text: string;
  files?: Record<string, string>;
  source?: string;
  version?: string;
  projectId?: string;
  agents?: Array<string>;
  replaces?: string;
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
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.duplicate
- validation.too_large

## Example

```json
{
  "name": "example",
  "input": {
    "agents": [
      "example"
    ],
    "files": {},
    "idempotencyKey": "idem_1",
    "projectId": "prj_a1b2c3",
    "replaces": "sko_a1b2c3",
    "source": "example",
    "text": "example",
    "version": "example"
  },
  "output": {
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
