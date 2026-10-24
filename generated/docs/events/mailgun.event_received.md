# mailgun.event_received

A verified Mailgun delivery event arrived

| | |
|---|---|
| Module | mailgun |
| Schema version | 1 |
| Subject | entity at /eventId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  eventId: string;
  event: "accepted" | "delivered" | "failed" | "opened" | "clicked" | "complained" | "unsubscribed";
  providerId: string;
};
```
