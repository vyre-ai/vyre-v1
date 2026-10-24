# agent.task_finished

A long agent task finished

| | |
|---|---|
| Module | engine |
| Schema version | 1 |
| Subject | thread at /threadId |
| Visibility | participants |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | agent.task_finished |
| Retention | default |

## Payload

```ts
type Payload = {
  agentId: string;
  threadId: string;
  turnId: string;
  durationMs: number;
};
```
