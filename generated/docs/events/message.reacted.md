# message.reacted

A reaction was added or removed

| | |
|---|---|
| Module | chat |
| Schema version | 1 |
| Subject | thread at /threadId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  messageId: string;
  threadId: string;
  emoji: string;
  removed: boolean;
};
```
