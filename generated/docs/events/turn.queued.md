# turn.queued

A turn was queued for an agent in a thread

| | |
|---|---|
| Module | engine |
| Schema version | 1 |
| Subject | thread at /threadId |
| Visibility | participants |
| Label | subject |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  threadId: string;
  agentId: string;
  kind: string;
  qseq: number;
  messageId?: string;
};
```
