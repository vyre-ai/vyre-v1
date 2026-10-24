# webhook.delivery_failed

A webhook delivery attempt failed

| | |
|---|---|
| Module | events |
| Schema version | 1 |
| Subject | entity at /webhookId |
| Visibility | space |
| Label | none |
| Replay | stub |
| Automation trigger | no |
| Notification | none |
| Retention | logs |

## Payload

```ts
type Payload = {
  deliveryId: string;
  webhookId: string;
  eventId: string;
  httpStatus?: number;
  error: string;
  attempts: number;
  willRetry: boolean;
};
```
