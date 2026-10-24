# twilio.recording.stop

Stop recording a live call

| | |
|---|---|
| Module | twilio |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | grant only |
| Grant level | use |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/twilio/recording/stop |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  callSid: string;
  recordingSid: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  stopped: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.network
- provider.unavailable
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "callSid": "example",
    "idempotencyKey": "idem_1",
    "recordingSid": "example"
  },
  "output": {
    "stopped": true
  }
}
```
