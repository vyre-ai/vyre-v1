# thread.started

A thread, chat or channel main thread was started

| | |
|---|---|
| Module | chat |
| Schema version | 1 |
| Subject | thread at /threadId |
| Visibility | participants |
| Label | subject |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | transcripts |

## Payload

```ts
type Payload = {
  threadId: string;
  kind: "chat" | "channel" | "thread" | "ask" | "run" | "helper" | "console";
  starter: string;
  parentThreadId?: string;
  channelId?: string;
  scopeType?: string;
  scopeId?: string;
};
```
