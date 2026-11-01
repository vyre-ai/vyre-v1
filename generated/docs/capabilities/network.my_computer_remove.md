# network.my_computer_remove

Remove one of your own computers or servers: its access ends at once

| | |
|---|---|
| Module | network |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | high |
| Resource | space |
| Gate | delete |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/network/my_computer_remove |
| MCP tool | network_my_computer_remove (engineer) |
| CLI | none |
| Emits | network.server_removed |

## Input

```ts
type In = {
  serverId: string;
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
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "serverId": "srv_a1b2c3"
  },
  "output": {
    "removed": true
  }
}
```
