# plugins.connection.add_mine

Connect an MCP server for you and your agents only (Mine): by https address, or by a command that runs in the sandbox (npx, uvx). A key is a Vault handle in env or a header.

| | |
|---|---|
| Module | agents |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | member |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/plugins/connection/add_mine |
| MCP tool | plugins_connection_add_mine (agents) |
| CLI | none |
| Emits | plugin.connection_added |

## Input

```ts
type In = {
  name: string;
  title?: string;
  url?: string;
  command?: string;
  args?: Array<string>;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  auth?: "oauth";
  source?: "registry" | "paste" | "import" | "hub" | "skill" | "kit" | "hand" | "plugin";
  sourceRef?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  connection: {
    connectionId: string;
    name: string;
    scope: "mine";
    owner: string;
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.duplicate
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "args": [
      "example"
    ],
    "auth": "oauth",
    "command": "example",
    "env": {},
    "headers": {},
    "idempotencyKey": "idem_1",
    "name": "notion",
    "source": "registry",
    "sourceRef": "example",
    "title": "example",
    "url": "example"
  },
  "output": {
    "connection": {
      "connectionId": "mcs_a1b2c3",
      "name": "example",
      "owner": "example",
      "scope": "mine"
    }
  }
}
```
