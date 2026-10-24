# calendar_event.response_changed

An attendee or the caller answered an invitation

| | |
|---|---|
| Module | calendar |
| Schema version | 1 |
| Subject | entity at /eventId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  eventId: string;
  email: string;
  response: "accepted" | "declined" | "tentative";
};
```
