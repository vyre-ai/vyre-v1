# subscription.created

A subscription started

| | |
|---|---|
| Module | stripe |
| Schema version | 1 |
| Subject | entity at /subscriptionId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | A subscription starts |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  eventId: string;
  customerId?: string;
  recordId?: string;
  siteId?: string;
  subscriptionId: string;
  priceId?: string;
};
```
