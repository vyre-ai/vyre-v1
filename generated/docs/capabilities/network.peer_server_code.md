# network.peer_server_code

Add a server to your Personal Space: a one-time code for the install line. The server joins through Vyre's relay (no address needed), keeps a full copy in sync, keeps the Space going and runs scheduled work while your computers sleep

| | |
|---|---|
| Module | network |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/network/peer_server_code |
| MCP tool | network_peer_server_code (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  nickname?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  code: string;
  expiresAt: number;
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
    "idempotencyKey": "idem_1",
    "nickname": "home-server"
  },
  "output": {
    "code": "VYRE-PS-eyJ2IjoxfQ",
    "expiresAt": 1760000000000
  }
}
```
