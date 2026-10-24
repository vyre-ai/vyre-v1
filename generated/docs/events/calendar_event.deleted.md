# calendar_event.deleted

An event was deleted (Undo restores it)

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
  calendarId: string;
};
```
