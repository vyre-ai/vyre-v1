# channel.agent_watch_changed

An agent started or stopped watching a channel

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
  agentId: string;
  watches: boolean;
  by: string;
};
```
