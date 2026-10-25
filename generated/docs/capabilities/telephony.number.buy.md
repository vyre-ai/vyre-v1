# telephony.number.buy

Buy a number from Twilio and assign it

| | |
|---|---|
| Module | telephony |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | comms.numbers |
| Grant level | use |
| Risk | high |
| Resource | space |
| Gate | pay |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/telephony/number/buy |
| MCP tool | telephony_number_buy (inbox) |
| CLI | none |
| Emits | number.purchased |

## Input

```ts
type In = {
  e164: string;
  title: string;
  assigneeKind: "person" | "agent" | "inbox";
  assigneeId?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  number: {
    id: string;
    e164: string;
    title: string;
    displayName?: string;
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
- permission.role_lacks_permission
- provider.auth_failed
- provider.network
- provider.unavailable
- validation.bad_input
- validation.duplicate

## Example

```json
{
  "name": "example",
  "input": {
    "assigneeId": "example",
    "assigneeKind": "person",
    "e164": "+14155550123",
    "idempotencyKey": "idem_1",
    "title": "example"
  },
  "output": {
    "number": {
      "a2p": "none",
      "assigneeId": "example",
      "assigneeKind": "person",
      "capabilities": [
        "voice"
      ],
      "displayName": "Intake line",
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
