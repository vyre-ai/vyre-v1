# twilio.receive_webhook

Record a verified Twilio webhook (voice, sms, status, recording) after signature check and dedupe, and hand it to telephony

| | |
|---|---|
| Module | twilio |
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
| HTTP | POST /v1/twilio/receive_webhook |
| MCP tool | none |
| CLI | none |
| Emits | twilio.voice_received, twilio.sms_received, twilio.status_received, twilio.recording_received |

## Input

```ts
type In = {
  kind: "voice" | "sms" | "status" | "recording";
  dedupeKey: string;
  sid: string;
  params: Record<string, string>;
};
```

## Output

```ts
type Out = {
  accepted: boolean;
  twiml?: string;
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
    "dedupeKey": "example",
    "kind": "voice",
    "params": {},
    "sid": "example"
  },
  "output": {
    "accepted": true,
    "twiml": "example"
  }
}
```
