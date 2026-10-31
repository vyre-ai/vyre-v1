# network.my_computer_code

Make a join code for your own computer or server (a Mac, PC or Linux box): it will run only your own agents. A nickname names it once it arrives; it also works in a Personal Space

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
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/network/my_computer_code |
| MCP tool | network_my_computer_code (engineer) |
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
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
    "nickname": "home-box"
  },
  "output": {
    "address": "example",
    "code": "VYRE-1234-ABCD",
    "expiresAt": 1760000000000
  }
}
```
