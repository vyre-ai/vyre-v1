# telephony.send_sms

Send a text through the single send API: suppression, SMS consent, send window, caps, Gate for agents and automations

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
| Offline | queue |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/telephony/send_sms |
| MCP tool | telephony_send_sms (inbox) |
| CLI | vyre sms send |
| Emits | message.sent, message.suppressed, message.failed |

## Input

```ts
type In = {
  numberId: string;
  to: string;
  body: string;
  mediaFileIds?: Array<string>;
  contactId?: string;
  replyToId?: string;
  campaignId?: string;
  sendAt?: number;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  smsId?: string;
  status: "queued" | "sent" | "held" | "suppressed";
  taskId?: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_approval
- permission.no_grant
- provider.auth_failed
- provider.network
- provider.rate_limited
- provider.unavailable
- rate_limit.exceeded
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "body": "example",
    "campaignId": "cmp_a1b2c3",
    "contactId": "rec_a1b2c3",
    "idempotencyKey": "idem_1",
    "mediaFileIds": [
      "fil_a1b2c3"
    ],
    "numberId": "num_a1b2c3",
    "replyToId": "sms_a1b2c3",
    "sendAt": 1760000000000,
    "to": "+14155550123"
  },
  "output": {
    "smsId": "sms_a1b2c3",
    "status": "queued",
    "taskId": "tsk_a1b2c3"
  }
}
```
