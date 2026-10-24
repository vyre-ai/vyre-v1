# channel.created

A channel was created

| | |
|---|---|
| Module | chat |
| Schema version | 1 |
| Subject | channel at /channelId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | A channel is created |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  channelId: string;
  name: string;
  visibility: string;
  recordId?: string;
};
```
