# network.server_join_code

Make a join code to add a cloud box or office Mac for compute. A nickname names it once it arrives

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
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/network/server_join_code |
| MCP tool | network_server_join_code (engineer) |
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
  address?: string;
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
    "idempotencyKey": "idem_1",
    "nickname": "berlin-box"
  },
  "output": {
    "address": "example",
    "code": "VYRE-1234-ABCD",
    "expiresAt": 1760000000000
  }
}
```
