# turn.failed

A turn failed; the thread accepts the next message as a fresh turn

| | |
|---|---|
| Module | engine |
| Schema version | 1 |
| Subject | thread at /threadId |
| Visibility | participants |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  turnId: string;
  threadId: string;
  agentId: string;
  code: string;
  message: string;
};
```
