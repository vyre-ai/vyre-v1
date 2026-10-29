# network.my_computer_code

Make a join code for your own computer (a Mac, PC or Linux box): it will run only your own agents

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
    "idempotencyKey": "idem_1"
  },
  "output": {
    "code": "VYRE-1234-ABCD",
    "expiresAt": 1760000000000
  }
}
```
