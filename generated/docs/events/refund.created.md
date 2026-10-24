# refund.created

A refund was created

| | |
|---|---|
| Module | stripe |
| Schema version | 1 |
| Subject | entity at /objectId |
| Visibility | space |
| Label | subject |
| Replay | stub |
| Automation trigger | no |
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
