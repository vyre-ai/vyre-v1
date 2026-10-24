# twilio.number.configure

Point a number at the Space webhooks and the TwiML app

| | |
|---|---|
| Module | twilio |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | comms.numbers |
| Grant level | use |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/twilio/number/configure |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  sid: string;
  voiceUrl?: string;
  smsUrl?: string;
  statusUrl?: string;
  twimlAppSid?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  number: {
    sid: string;
    e164: string;
    friendlyName?: string;
    capabilities: Array<string>;
    voiceUrl?: string;
    smsUrl?: string;
    statusUrl?: string;
  };
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

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
    "sid": "example",
    "smsUrl": "example",
    "statusUrl": "example",
    "twimlAppSid": "example",
    "voiceUrl": "example"
  },
  "output": {
    "number": {
      "capabilities": [
        "example"
      ],
      "e164": "+14155550123",
      "friendlyName": "example",
      "sid": "example",
      "smsUrl": "example",
      "statusUrl": "example",
      "voiceUrl": "example"
    }
  }
}
```
