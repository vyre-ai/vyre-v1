# calendar.created

A calendar was made in Vyre; it is a resource owned by the person who made it

| | |
|---|---|
| Module | calendar |
| Schema version | 1 |
| Subject | calendar at /calendarId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  calendarId: string;
  personal: boolean;
};
```
