# telephony.hold

Put a call on hold or take it off hold

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
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/telephony/hold |
| MCP tool | telephony_hold (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  callId: string;
  hold: boolean;
};
```

## Output

```ts
type Out = {
  call: {
    id: string;
    numberId: string;
    direction: "in" | "out";
    from: string;
    to: string;
    contactId?: string;
    state: "ringing" | "answered" | "voicemail" | "completed" | "missed" | "failed";
    startedAt: number;
    answeredAt?: number;
    endedAt?: number;
    durationSec?: number;
    handledBy?: {
      kind: "person" | "agent" | "group";
      id: string;
    };
    recordingFileId?: string;
    hasTranscript: boolean;
    summary?: string;
    consentLogged: boolean;
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
    "callId": "cal_a1b2c3",
    "hold": true
  },
  "output": {
    "call": {
      "answeredAt": 1760000000000,
      "consentLogged": true,
      "contactId": "rec_a1b2c3",
      "direction": "in",
      "durationSec": 1,
      "endedAt": 1760000000000,
      "from": "example",
      "handledBy": {
        "id": "usr_a1b2c3",
        "kind": "person"
      },
      "hasTranscript": true,
      "id": "cal_a1b2c3",
      "numberId": "num_a1b2c3",
      "recordingFileId": "fil_a1b2c3",
      "startedAt": 1760000000000,
      "state": "ringing",
      "summary": "example",
      "to": "example"
    }
  }
}
```
