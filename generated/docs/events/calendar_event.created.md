# calendar_event.created

An event was created in Vyre or arrived from a provider

| | |
|---|---|
| Module | calendar |
| Schema version | 1 |
| Subject | entity at /eventId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | An event is created |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  eventId: string;
  calendarId: string;
  startsAt: number;
  attendeeCount: number;
  source: "vyre" | "google" | "microsoft" | "booking";
};
```
