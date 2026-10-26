# channel.erased

A channel was erased for good with its messages (ids only)

| | |
|---|---|
| Module | chat |
| Schema version | 1 |
| Subject | entity at /channelId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  channelId: string;
};
```
