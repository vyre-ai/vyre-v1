# twilio.a2p.create_campaign

Register the texting campaign (use case, sample messages, opt-in) under the brand

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
| HTTP | POST /v1/twilio/a2p/create_campaign |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  brandSid: string;
  useCase: string;
  description: string;
  sampleMessages: Array<string>;
  optInDescription?: string;
  messagingServiceSid?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  campaignSid: string;
  status: string;
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
    "brandSid": "example",
    "description": "example",
    "idempotencyKey": "idem_1",
    "messagingServiceSid": "example",
    "optInDescription": "example",
    "sampleMessages": [
      "example"
    ],
    "useCase": "example"
  },
  "output": {
    "campaignSid": "example",
    "status": "example"
  }
}
```
