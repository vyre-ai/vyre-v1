# plugins.get

One installed plugin with the skills, commands, sub-agents, hooks and MCP servers it brought

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
| HTTP | POST /v1/plugins/get |
| MCP tool | plugins_get (agents) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  pluginId: string;
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
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
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
