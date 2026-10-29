# network.server_decline

Turn a waiting computer away

| | |
|---|---|
| Module | network |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | server.network |
| Grant level | manage |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/network/server_decline |
| MCP tool | network_server_decline (engineer) |
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
  state: "declined";
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
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
    "state": "declined"
  }
}
```
