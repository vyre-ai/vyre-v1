# plugins.config.set

Set the options a plugin asks for; a secret option takes a Vault handle, never a value

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
| HTTP | POST /v1/plugins/config/set |
| MCP tool | plugins_config (agents) |
| CLI | none |
| Emits | plugin.changed |

## Input

```ts
type In = {
  pluginId: string;
  config: Record<string, string>;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  plugin: {
    pluginId: string;
    name: string;
    marketplace: string;
    marketplaceId: string;
    scope: "space" | "agent";
    agentId?: string;
    version?: string;
    description?: string;
    enabled: boolean;
    parts: {
      skills: Array<string>;
      commands: Array<string>;
      agents: Array<string>;
      hooks: number;
      mcpServers: Array<string>;
    };
    userConfig: Array<{
        key: string;
        type: string;
        title: string;
        description: string;
        required: boolean;
        sensitive: boolean;
      }>;
    config: Record<string, string>;
    configured: boolean;
    warnings: Array<string>;
    installedAt: number;
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
    "config": {},
    "idempotencyKey": "idem_1",
    "pluginId": "plg_a1b2c3"
  },
  "output": {
    "plugin": {
      "agentId": "agt_a1b2c3",
      "config": {},
      "configured": true,
      "description": "example",
      "enabled": true,
      "installedAt": 1760000000000,
      "marketplace": "example",
      "marketplaceId": "mkt_a1b2c3",
      "name": "deploy-tools",
      "parts": {
        "agents": [
          "example"
        ],
        "commands": [
          "example"
        ],
        "hooks": 1,
        "mcpServers": [
          "example"
        ],
        "skills": [
          "example"
        ]
      },
      "pluginId": "plg_a1b2c3",
      "scope": "space",
      "userConfig": [
        {
          "description": "example",
          "key": "example",
          "required": true,
          "sensitive": true,
          "title": "example",
          "type": "example"
        }
      ],
      "version": "example",
      "warnings": [
        "example"
      ]
    }
  }
}
```
