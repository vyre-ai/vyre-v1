# meeting.merged

A calendar event and a provider meeting became one Meeting

| | |
|---|---|
| Module | meetings |
| Schema version | 1 |
| Subject | record at /meetingId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  meetingId: string;
  eventId?: string;
  providerRef?: string;
  by: "time_and_attendees" | "link" | "person";
};
```
