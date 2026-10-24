# telephony.ingest_status

Apply a call or text status callback (ended, missed, voicemail, delivered, undelivered, failed)

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
| HTTP | POST /v1/telephony/ingest_status |
| MCP tool | none |
| CLI | none |
| Emits | call.ended, call.missed, call.voicemail_left, message.delivered, message.bounced, message.failed |

## Input

```ts
type In = {
  sid: string;
  kind: "call" | "sms";
  status: string;
  errorCode?: string;
  durationSec?: number;
  at: number;
};
```

## Output

```ts
type Out = {
  applied: boolean;
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
    "durationSec": 1,
    "errorCode": "example",
    "kind": "call",
    "sid": "example",
    "status": "example"
  },
  "output": {
    "applied": true
  }
}
```
