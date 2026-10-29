# plugins.connection.remove

Disconnect an MCP server made by hand

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
| HTTP | POST /v1/plugins/connection/remove |
| MCP tool | plugins_connection_remove (agents) |
| CLI | none |
| Emits | plugin.connection_removed |

## Input

```ts
type In = {
  connectionId?: string;
  name?: string;
  scope?: "space" | "agent";
  agentId?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  removed: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "agentId": "agt_a1b2c3",
    "connectionId": "mcs_a1b2c3",
    "idempotencyKey": "idem_1",
    "name": "example",
    "scope": "space"
  },
  "output": {
    "removed": true
  }
}
```
