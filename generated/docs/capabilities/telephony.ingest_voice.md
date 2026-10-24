# telephony.ingest_voice

Land an incoming call and answer with the routing instruction for the number, hours and consent

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
| HTTP | POST /v1/telephony/ingest_voice |
| MCP tool | none |
| CLI | none |
| Emits | call.ringing |

## Input

```ts
type In = {
  callSid: string;
  from: string;
  to: string;
  status: string;
  callerName?: string;
  forwardedFrom?: string;
};
```

## Output

```ts
type Out = {
  callId: string;
  instruction: {
    action: "ring" | "voicemail" | "reject" | "agent";
    targets: Array<{
        kind: "person" | "agent" | "group";
        id: string;
      }>;
    ringSeconds?: number;
    greeting?: string;
    record: boolean;
    announcement?: string;
  };
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
    "callerName": "example",
    "forwardedFrom": "example",
    "from": "example",
    "status": "example",
    "to": "+14155550123"
  },
  "output": {
    "callId": "cal_a1b2c3",
    "instruction": {
      "action": "ring",
      "announcement": "example",
      "greeting": "example",
      "record": true,
      "ringSeconds": 1,
      "targets": [
        {
          "id": "usr_a1b2c3",
          "kind": "person"
        }
      ]
    }
  }
}
```
