# calendar.created

A calendar came into being: a private local one, or a member's Google or Outlook calendar connected by an admin

| | |
|---|---|
| Module | calendar |
| Schema version | 1 |
| Subject | calendar at /calendarId |
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
  provider: "google" | "microsoft" | "local";
  ownerId: string;
  private: boolean;
};
```
