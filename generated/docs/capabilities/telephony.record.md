# telephony.record

Start or stop recording a call; consent (announcement or ask) is logged

| | |
|---|---|
| Module | telephony |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/telephony/record |
| MCP tool | telephony_record (inbox) |
| CLI | none |
| Emits | call.recording_changed |

## Input

```ts
type In = {
  callId: string;
  action: "start" | "stop";
  consent?: {
    announced: boolean;
    confirmedBy?: string;
  };
};
```

## Output

```ts
type Out = {
  recording: boolean;
  consentLogged: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "action": "start",
    "callId": "cal_a1b2c3",
    "consent": {
      "announced": true,
      "confirmedBy": "example"
    }
  },
  "output": {
    "consentLogged": true,
    "recording": true
  }
}
```
