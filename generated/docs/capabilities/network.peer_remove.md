# network.peer_remove

Take a computer out of this Personal Space: it stops syncing with your other computers

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
| HTTP | POST /v1/network/peer_remove |
| MCP tool | network_peer_remove (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  peerId: string;
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
    "peerId": "example"
  },
  "output": {
    "removed": true
  }
}
```
