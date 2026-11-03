# skills.shared.decide

Add a skill shared with you, so it applies to you and your agents, or say Not now

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
| HTTP | POST /v1/skills/shared/decide |
| MCP tool | skills_shared_decide (agents) |
| CLI | none |
| Emits | skill.share_decided |

## Input

```ts
type In = {
  skillId: string;
  decision: "add" | "not_now";
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  card: {
    skillId: string;
    name: string;
    label?: string;
    description: string;
    sharer: string;
    sharerName: string;
    toSpace: boolean;
    source: string;
    origin: string;
    version?: string;
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
    state: "waiting" | "added" | "not_now";
    growth: Array<string>;
    agents: Array<string>;
    enabled: boolean;
    setup: Record<string, string>;
    needs: Array<string>;
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

## Example

```json
{
  "name": "example",
  "input": {
    "decision": "add",
    "idempotencyKey": "idem_1",
    "skillId": "sko_a1b2c3"
  },
  "output": {
    "card": {
      "agents": [
        "example"
      ],
      "description": "example",
      "enabled": true,
      "growth": [
        "example"
      ],
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
      "setup": {},
      "sharer": "example",
      "sharerName": "example",
      "skillId": "sko_a1b2c3",
      "source": "example",
      "state": "waiting",
      "toSpace": true,
      "updatedAt": 1760000000000,
      "version": "example"
    }
  }
}
```
