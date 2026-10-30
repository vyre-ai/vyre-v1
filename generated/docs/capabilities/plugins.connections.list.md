# plugins.connections.list

MCP connections made by hand (a URL or a command)

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
| HTTP | POST /v1/plugins/connections/list |
| MCP tool | plugins_connections (agents) |
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
  connections: Array<{
      connectionId: string;
      name: string;
      scope: "space" | "agent";
      agentId?: string;
      transport: "stdio" | "http";
      url?: string;
      command?: string;
      args: Array<string>;
      env: Record<string, string>;
      headers: Record<string, string>;
      enabled: boolean;
      createdAt: number;
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
    "connections": [
      {
        "agentId": "agt_a1b2c3",
        "args": [
          "example"
        ],
        "command": "example",
        "connectionId": "mcs_a1b2c3",
        "createdAt": 1760000000000,
        "enabled": true,
        "env": {},
        "headers": {},
        "name": "example",
        "scope": "space",
        "transport": "stdio",
        "url": "example"
      }
    ]
  }
}
```
