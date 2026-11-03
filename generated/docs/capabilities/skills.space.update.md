# skills.space.update

Console: fetch a Space skill again from its link or repo

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
| HTTP | POST /v1/skills/space/update |
| MCP tool | none |
| CLI | none |
| Emits | skill.added |

## Input

```ts
type In = {
  name: string;
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
    from?: string;
    updatedAt?: number;
  };
  changed: boolean;
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
    "name": "example"
  },
  "output": {
    "changed": true,
    "skill": {
      "description": "example",
      "enabled": true,
      "from": "example",
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
      "skillId": "example",
      "source": "example",
      "updatedAt": 1760000000000,
      "version": "example"
    }
  }
}
```
