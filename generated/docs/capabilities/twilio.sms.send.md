# twilio.sms.send

Send a text (the transport behind telephony.send_sms)

| | |
|---|---|
| Module | twilio |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | grant only |
| Grant level | use |
| Risk | high |
| Resource | space |
| Gate | send |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/twilio/sms/send |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  from: string;
  to: string;
  body: string;
  mediaUrls?: Array<string>;
  statusCallback?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  sid: string;
  status: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.auth_failed
- provider.network
- provider.rate_limited
- provider.unavailable
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "body": "example",
    "from": "+14155550123",
    "idempotencyKey": "idem_1",
    "mediaUrls": [
      "example"
    ],
    "statusCallback": "example",
    "to": "+14155550123"
  },
  "output": {
    "sid": "example",
    "status": "example"
  }
}
```
