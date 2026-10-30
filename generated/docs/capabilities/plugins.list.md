# plugins.list

Installed plugins: in the whole Space, and in one agent when agentId is given

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
| HTTP | POST /v1/plugins/list |
| MCP tool | plugins_list (agents) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  agentId?: string;
};
```

## Output

```ts
type Out = {
  plugins: Array<{
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
    "agentId": "agt_a1b2c3"
  },
  "output": {
    "plugins": [
      {
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
    ]
  }
}
```
