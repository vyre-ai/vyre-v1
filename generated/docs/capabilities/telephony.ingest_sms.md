# telephony.ingest_sms

Land an incoming text; STOP and UNSUBSCRIBE suppress the sender and link the contact

| | |
|---|---|
| Module | telephony |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/telephony/ingest_sms |
| MCP tool | none |
| CLI | none |
| Emits | sms.received |

## Input

```ts
type In = {
  messageSid: string;
  from: string;
  to: string;
  body: string;
  mediaUrls?: Array<string>;
  at: number;
};
```

## Output

```ts
type Out = {
  smsId: string;
  optOut: boolean;
  contactId?: string;
  conversationId?: string;
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
    "at": 1760000000000,
    "body": "example",
    "from": "+14155550123",
    "mediaUrls": [
      "example"
    ],
    "messageSid": "example",
    "to": "+14155550123"
  },
  "output": {
    "contactId": "rec_a1b2c3",
    "conversationId": "cnv_a1b2c3",
    "optOut": true,
    "smsId": "sms_a1b2c3"
  }
}
```
