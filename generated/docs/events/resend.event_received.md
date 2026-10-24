# resend.event_received

A verified Resend delivery event arrived

| | |
|---|---|
| Module | resend |
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
  type: "sent" | "delivered" | "bounced" | "complained" | "opened" | "clicked" | "failed" | "delayed";
  providerId: string;
};
```
