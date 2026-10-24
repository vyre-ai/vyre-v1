# thread.replied

A reply landed in a thread someone follows

| | |
|---|---|
| Module | chat |
| Schema version | 1 |
| Subject | thread at /threadId |
| Visibility | participants |
| Label | subject |
| Replay | pure |
| Automation trigger | no |
| Notification | reply.followed |
| Retention | default |

## Payload

```ts
type Payload = {
  threadId: string;
  parentThreadId?: string;
  messageId: string;
  personId: string;
};
```
