# channel.archived

A channel was archived

| | |
|---|---|
| Module | chat |
| Schema version | 1 |
| Subject | channel at /channelId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  channelId: string;
};
```
