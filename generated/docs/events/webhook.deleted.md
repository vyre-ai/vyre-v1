# webhook.deleted

An outgoing webhook was deleted

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
};
```
