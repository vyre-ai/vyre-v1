# telephony.number.get

Read one number

| | |
|---|---|
| Module | telephony |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | number (/numberId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/telephony/number/get |
| MCP tool | telephony_number_get (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  numberId: string;
};
```

## Output

```ts
type Out = {
  number: {
    id: string;
    e164: string;
    title: string;
    capabilities: Array<"voice" | "sms" | "mms">;
    assigneeKind: "person" | "agent" | "inbox";
    assigneeId?: string;
    route: {
      ring: Array<{
          kind: "person" | "agent" | "group";
          id: string;
        }>;
      ringSeconds: number;
      voicemail: boolean;
      voicemailTranscript: boolean;
    };
    hours: {
      zone: string;
      weekly: Array<{
          day: number;
          start: string;
          end: string;
        }>;
      outsideHours: "voicemail" | "ring" | "reject";
    };
    recording: "off" | "announce" | "ask";
    a2p: "none" | "pending" | "approved" | "rejected";
    state: "pending" | "active" | "released";
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "numberId": "num_a1b2c3"
  },
  "output": {
    "number": {
      "a2p": "none",
      "assigneeId": "example",
      "assigneeKind": "person",
      "capabilities": [
        "voice"
      ],
      "e164": "+14155550123",
      "hours": {
        "outsideHours": "voicemail",
        "weekly": [
          {
            "day": 1,
            "end": "17:00",
            "start": "09:00"
          }
        ],
        "zone": "America/Los_Angeles"
      },
      "id": "num_a1b2c3",
      "recording": "off",
      "route": {
        "ring": [
          {
            "id": "usr_a1b2c3",
            "kind": "person"
          }
        ],
        "ringSeconds": 5,
        "voicemail": true,
        "voicemailTranscript": true
      },
      "state": "pending",
      "title": "example"
    }
  }
}
```
