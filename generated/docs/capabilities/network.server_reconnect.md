# network.server_reconnect

Reconnect an offline server

| | |
|---|---|
| Module | network |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | server.network |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/network/server_reconnect |
| MCP tool | network_server_reconnect (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  serverId: string;
};
```

## Output

```ts
type Out = {
  state: "healthy" | "degraded" | "down";
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
    "serverId": "srv_a1b2c3"
  },
  "output": {
    "state": "healthy"
  }
}
```
