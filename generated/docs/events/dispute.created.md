# dispute.created

A customer opened a dispute

| | |
|---|---|
| Module | stripe |
| Schema version | 1 |
| Subject | entity at /objectId |
| Visibility | space |
| Label | subject |
| Replay | stub |
| Automation trigger | A dispute opens |
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
