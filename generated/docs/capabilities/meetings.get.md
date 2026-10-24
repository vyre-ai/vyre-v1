# meetings.get

Read a meeting with recording, transcript, summary and decisions

| | |
|---|---|
| Module | meetings |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | record (/meetingId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/meetings/get |
| MCP tool | meetings_get (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  meetingId: string;
};
```

## Output

```ts
type Out = {
  meeting: {
    id: string;
    title: string;
    startsAt: number;
    endsAt?: number;
    provider: "zoom" | "meet" | "teams" | "none";
    joinUrl?: string;
    status: "scheduled" | "live" | "ended" | "canceled";
    organizer?: string;
    attendeeIds: Array<string>;
    calendarEventId?: string;
    recordingState: "none" | "pending" | "attached" | "unavailable";
    hasTranscript: boolean;
    hasSummary: boolean;
  };
  recordingFileId?: string;
  recordingDurationSec?: number;
  transcript?: string;
  summary?: string;
  decisions?: string;
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
    "meetingId": "rec_a1b2c3"
  },
  "output": {
    "decisions": "example",
    "meeting": {
      "attendeeIds": [
        "rec_a1b2c3"
      ],
      "calendarEventId": "cev_a1b2c3",
      "endsAt": 1760000000000,
      "hasSummary": true,
      "hasTranscript": true,
      "id": "rec_a1b2c3",
      "joinUrl": "example",
      "organizer": "usr_a1b2c3",
      "provider": "zoom",
      "recordingState": "none",
      "startsAt": 1760000000000,
      "status": "scheduled",
      "title": "example"
    },
    "recordingDurationSec": 1,
    "recordingFileId": "fil_a1b2c3",
    "summary": "example",
    "transcript": "example"
  }
}
```
