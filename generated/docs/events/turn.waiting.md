# turn.waiting

A turn parked and waits on a task, an answer, a run or a time

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
  taskId?: string;
  blockId?: string;
  runId?: string;
};
```
