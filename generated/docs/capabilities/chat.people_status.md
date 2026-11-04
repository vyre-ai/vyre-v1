# chat.people_status

Your teammates as you see them: online, away or offline and when last seen, their local time and working hours, and when a message to them would go. Only people in this Space, never anything private

| | |
|---|---|
| Module | chat |
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
| HTTP | POST /v1/chat/people_status |
| MCP tool | people_status (chats, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  personIds?: Array<string>;
  q?: string;
};
```

## Output

```ts
type Out = {
  people: Array<{
      handle: string;
      name: string;
      state: "online" | "away" | "offline" | "unknown";
      lastSeenAt?: number;
      awayUntil?: number;
      timezone?: string;
      localTime?: string;
      hours?: string;
      inHours: boolean;
      mutedUntil?: number;
      wouldGo: string;
    }>;
  how: string;
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
    "personIds": [
      "usr_a1b2c3"
    ],
    "q": "example"
  },
  "output": {
    "how": "example",
    "people": [
      {
        "awayUntil": 1760000000000,
        "handle": "aliza-3c6",
        "hours": "Mon to Fri, 09:00 to 17:00",
        "inHours": true,
        "lastSeenAt": 1760000000000,
        "localTime": "3:40 PM",
        "mutedUntil": 1760000000000,
        "name": "example",
        "state": "online",
        "timezone": "Asia/Karachi",
        "wouldGo": "example"
      }
    ]
  }
}
```
