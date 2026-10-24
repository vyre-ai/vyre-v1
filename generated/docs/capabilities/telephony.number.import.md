# telephony.number.import

Bring numbers that already exist in the Twilio account into the Space

| | |
|---|---|
| Module | telephony |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | comms.numbers |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/telephony/number/import |
| MCP tool | telephony_number_import (inbox) |
| CLI | none |
| Emits | number.assigned |

## Input

```ts
type In = {
  e164?: Array<string>;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  imported: number;
  numbers: Array<{
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
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "e164": [
      "+14155550123"
    ],
    "idempotencyKey": "idem_1"
  },
  "output": {
    "imported": 1,
    "numbers": [
      {
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
    ]
  }
}
```
