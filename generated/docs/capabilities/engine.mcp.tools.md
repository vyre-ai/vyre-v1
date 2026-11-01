# engine.mcp.tools

The MCP servers a chat with this agent connects to and the tools each offers (starts the server in the sandbox if it is not running)

| | |
|---|---|
| Module | engine |
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
| HTTP | POST /v1/engine/mcp/tools |
| MCP tool | mcp_tools (agents) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  agentId: string;
  server?: string;
};
```

## Output

```ts
type Out = {
  servers: Array<{
      key: string;
      name: string;
      from: "plugin" | "connection";
      ok: boolean;
      error?: string;
      tools: Array<{
          name: string;
          description: string;
          inputSchema: unknown;
          readOnly: boolean;
        }>;
      hub?: "composio" | "pipedream";
      oauth?: boolean;
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
    "server": "example"
  },
  "output": {
    "servers": [
      {
        "error": "example",
        "from": "plugin",
        "hub": "composio",
        "key": "greeter/echo",
        "name": "example",
        "oauth": true,
        "ok": true,
        "tools": [
          {
            "description": "example",
            "inputSchema": {},
            "name": "example",
            "readOnly": true
          }
        ]
      }
    ]
  }
}
```
