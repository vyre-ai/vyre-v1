# network.relay_set

Switch the Space to the relay or back, with no re-invite (devices pin the Space key, not the address)

| | |
|---|---|
| Module | network |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | server.network |
| Grant level | manage |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/network/relay_set |
| MCP tool | network_relay_set (engineer) |
| CLI | none |
| Emits | network.domain_changed |

## Input

```ts
type In = {
  mode: "own_domain" | "relay";
};
```

## Output

```ts
type Out = {
  address: string;
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
    "mode": "own_domain"
  },
  "output": {
    "address": "example"
  }
}
```
