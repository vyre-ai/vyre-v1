# stripe.event_received

A verified Stripe event arrived

| | |
|---|---|
| Module | stripe |
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
  type: string;
  objectId: string;
};
```
