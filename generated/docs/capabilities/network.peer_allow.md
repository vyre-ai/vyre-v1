# network.peer_allow

Let a new computer use this Personal Space: it gets a full copy of your chats, files, records and Vault (still locked by your password) and stays in sync

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
| HTTP | POST /v1/network/peer_allow |
| MCP tool | network_peer_allow (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  requestId: string;
};
```

## Output

```ts
type Out = {
  state: "allowed";
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
    "requestId": "example"
  },
  "output": {
    "state": "allowed"
  }
}
```
