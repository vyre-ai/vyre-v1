# webhook.created

An outgoing webhook was created

| | |
|---|---|
| Module | events |
| Schema version | 1 |
| Subject | entity at /webhookId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | events |

## Payload

```ts
type Payload = {
  webhookId: string;
  name: string;
  eventTypes: Array<string>;
};
```
