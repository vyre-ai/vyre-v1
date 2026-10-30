# plugins.mcp.servers

The MCP servers a chat with this agent connects to: from plugins in the Space, plugins in the agent and connections made by hand. Secrets are Vault handles.

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
| HTTP | POST /v1/plugins/mcp/servers |
| MCP tool | plugins_mcp_servers (agents) |
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
  servers: Array<{
      key: string;
      name: string;
      from: "plugin" | "connection";
      pluginId?: string;
      transport: "stdio" | "http" | "sse" | "ws";
      command?: string;
      args: Array<string>;
      env: Record<string, string>;
      url?: string;
      headers: Record<string, string>;
      files?: string;
      needs: Array<string>;
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
    "servers": [
      {
        "args": [
          "example"
        ],
        "command": "example",
        "env": {},
        "files": "example",
        "from": "plugin",
        "headers": {},
        "key": "deploy-tools/api",
        "name": "example",
        "needs": [
          "example"
        ],
        "pluginId": "plg_a1b2c3",
        "transport": "stdio",
        "url": "example"
      }
    ]
  }
}
```
