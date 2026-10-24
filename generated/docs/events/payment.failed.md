# payment.failed

A payment failed

| | |
|---|---|
| Module | stripe |
| Schema version | 1 |
| Subject | entity at /objectId |
| Visibility | space |
| Label | subject |
| Replay | stub |
| Automation trigger | A payment fails |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  eventId: string;
  customerId?: string;
  recordId?: string;
  siteId?: string;
  objectId: string;
  amount: number;
  currency: string;
};
```
