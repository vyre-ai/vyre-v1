# network.my_computer_approve

Admit your own waiting computer

| | |
|---|---|
| Module | network |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | high |
| Resource | space |
| Gate | enroll_node when actor.kind != 'person' |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/network/my_computer_approve |
| MCP tool | network_my_computer_approve (engineer) |
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
- permission.no_grant
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
