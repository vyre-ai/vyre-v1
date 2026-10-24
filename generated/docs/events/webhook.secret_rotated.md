# webhook.secret_rotated

The signing secret of a webhook was rotated (value not in the event)

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
| Retention | audit |

## Payload

```ts
type Payload = {
  webhookId: string;
  by: string;
};
```
