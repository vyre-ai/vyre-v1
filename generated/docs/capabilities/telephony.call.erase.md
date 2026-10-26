# telephony.call.erase

Erase one call for good: its transcript, summary and recording file (governance erase)

| | |
|---|---|
| Module | telephony |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | policy.manage |
| Grant level | manage |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/telephony/call/erase |
| MCP tool | none |
| CLI | none |
| Emits | call.erased |

## Input

```ts
type In = {
  callId: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  erased: boolean;
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
    "callId": "cal_a1b2c3",
    "idempotencyKey": "idem_1"
  },
  "output": {
    "erased": true
  }
}
```
