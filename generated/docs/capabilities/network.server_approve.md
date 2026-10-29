# network.server_approve

Admit a waiting computer to the Space: a person looks at its name, what it runs on and its fingerprint and approves once

| | |
|---|---|
| Module | network |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | server.network |
| Grant level | manage |
| Risk | high |
| Resource | space |
| Gate | enroll_node when actor.kind != 'person' |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/network/server_approve |
| MCP tool | network_server_approve (engineer) |
| CLI | none |
| Emits | network.server_added |

## Input

```ts
type In = {
  serverId: string;
};
```

## Output

```ts
type Out = {
  state: "approved";
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
    "state": "approved"
  }
}
```
