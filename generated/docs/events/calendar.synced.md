# calendar.synced

A calendar finished a sync pass

| | |
|---|---|
| Module | calendar |
| Schema version | 1 |
| Subject | entity at /calendarId |
| Visibility | participants |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  calendarId: string;
  upserted: number;
  removed: number;
};
```
