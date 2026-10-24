# channel.updated

A channel changed name, topic or visibility

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
  fields: Array<string>;
};
```
