# network.my_computer_decline

Turn your own waiting computer away

| | |
|---|---|
| Module | network |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/network/my_computer_decline |
| MCP tool | network_my_computer_decline (engineer) |
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
    "state": "declined"
  }
}
```
