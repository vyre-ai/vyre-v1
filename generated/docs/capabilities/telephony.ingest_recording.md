# telephony.ingest_recording

Download a finished recording or voicemail into Files and attach it to the call

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
| HTTP | POST /v1/telephony/ingest_recording |
| MCP tool | none |
| CLI | none |
| Emits | call.recording_ready |

## Input

```ts
type In = {
  callSid: string;
  recordingSid: string;
  url: string;
  durationSec?: number;
};
```

## Output

```ts
type Out = {
  callId: string;
  fileId: string;
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
    "callSid": "example",
    "durationSec": 1,
    "recordingSid": "example",
    "url": "example"
  },
  "output": {
    "callId": "cal_a1b2c3",
    "fileId": "fil_a1b2c3"
  }
}
```
