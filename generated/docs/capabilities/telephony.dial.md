# telephony.dial

Place a call from a number (the softphone connects through the Voice SDK with the returned parameters)

| | |
|---|---|
| Module | telephony |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | grant only |
| Grant level | use |
| Risk | high |
| Resource | number (/numberId) |
| Gate | send |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/telephony/dial |
| MCP tool | telephony_dial (inbox) |
| CLI | vyre call |
| Emits | call.started |

## Input

```ts
type In = {
  numberId: string;
  to: string;
  contactId?: string;
  record?: boolean;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  callId: string;
  params: Record<string, string>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_approval
- permission.no_grant
- provider.auth_failed
- provider.network
- provider.unavailable
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "contactId": "rec_a1b2c3",
    "idempotencyKey": "idem_1",
    "numberId": "num_a1b2c3",
    "record": true,
    "to": "+14155550123"
  },
  "output": {
    "callId": "cal_a1b2c3",
    "params": {}
  }
}
```
