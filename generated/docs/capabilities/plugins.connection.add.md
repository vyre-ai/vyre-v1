# plugins.connection.add

Connect an MCP server by URL (remote) or by command (runs in the sandbox), for the Space or one agent; works for every model

| | |
|---|---|
| Module | agents |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | agents.manage |
| Grant level | manage |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/plugins/connection/add |
| MCP tool | plugins_connection_add (agents) |
| CLI | none |
| Emits | plugin.connection_added |

## Input

```ts
type In = {
  name: string;
  scope: "space" | "agent";
  agentId?: string;
  url?: string;
  command?: string;
  args?: Array<string>;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  hub?: "composio" | "pipedream";
  auth?: "oauth";
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  connection: {
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
    hub?: "composio" | "pipedream";
    auth?: "oauth";
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

## Example

```json
{
  "name": "example",
  "input": {
    "agentId": "agt_a1b2c3",
    "args": [
      "example"
    ],
    "auth": "oauth",
    "command": "example",
    "env": {},
    "headers": {},
    "hub": "composio",
    "idempotencyKey": "idem_1",
    "name": "crm",
    "scope": "space",
    "url": "example"
  },
  "output": {
    "connection": {
      "agentId": "agt_a1b2c3",
      "args": [
        "example"
      ],
      "auth": "oauth",
      "command": "example",
      "connectionId": "mcs_a1b2c3",
      "createdAt": 1760000000000,
      "enabled": true,
      "env": {},
      "headers": {},
      "hub": "composio",
      "name": "example",
      "scope": "space",
      "transport": "stdio",
      "url": "example"
    }
  }
}
```
