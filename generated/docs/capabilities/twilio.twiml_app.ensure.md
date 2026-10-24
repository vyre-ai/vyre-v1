# twilio.twiml_app.ensure

Find or create the TwiML app of this Space for the Voice JS SDK

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
| HTTP | POST /v1/twilio/twiml_app/ensure |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  voiceUrl: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  appSid: string;
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
    "voiceUrl": "example"
  },
  "output": {
    "appSid": "example"
  }
}
```
