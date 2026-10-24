# telephony.call.list

List calls and voicemails (the Calls only view)

| | |
|---|---|
| Module | telephony |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/telephony/call/list |
| MCP tool | telephony_call_list (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  numberId?: string;
  contactId?: string;
  direction?: "in" | "out";
  state?: "ringing" | "answered" | "voicemail" | "completed" | "missed" | "failed";
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  calls: Array<{
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
    }>;
  next?: string;
  total?: number;
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
    "contactId": "rec_a1b2c3",
    "cursor": "example",
    "direction": "in",
    "limit": 1,
    "numberId": "num_a1b2c3",
    "state": "ringing"
  },
  "output": {
    "calls": [
      {
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
    ],
    "next": "example",
    "total": 1
  }
}
```
