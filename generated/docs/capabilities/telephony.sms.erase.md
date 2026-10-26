# telephony.sms.erase

Erase one text message for good (governance erase)

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
| HTTP | POST /v1/telephony/sms/erase |
| MCP tool | none |
| CLI | none |
| Emits | sms.erased |

## Input

```ts
type In = {
  smsId: string;
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
    "idempotencyKey": "idem_1",
    "smsId": "sms_a1b2c3"
  },
  "output": {
    "erased": true
  }
}
```
