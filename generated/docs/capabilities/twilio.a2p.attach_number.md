# twilio.a2p.attach_number

Attach a number to the registered messaging service

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
| HTTP | POST /v1/twilio/a2p/attach_number |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  messagingServiceSid: string;
  numberSid: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  attached: boolean;
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
    "messagingServiceSid": "example",
    "numberSid": "example"
  },
  "output": {
    "attached": true
  }
}
```
