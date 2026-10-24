# telephony.number.release

Release a number back to Twilio

| | |
|---|---|
| Module | telephony |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | comms.numbers |
| Grant level | manage |
| Risk | high |
| Resource | number (/numberId) |
| Gate | delete |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/telephony/number/release |
| MCP tool | telephony_number_release (inbox) |
| CLI | none |
| Emits | number.released |

## Input

```ts
type In = {
  numberId: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  released: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- provider.network
- provider.unavailable
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
    "numberId": "num_a1b2c3"
  },
  "output": {
    "released": true
  }
}
```
