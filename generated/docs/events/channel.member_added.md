# channel.member_added

A person joined a channel or thread

| | |
|---|---|
| Module | chat |
| Schema version | 1 |
| Subject | entity at /personId |
| Visibility | participants |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  channelId?: string;
  threadId?: string;
  personId: string;
  by: string;
};
```
