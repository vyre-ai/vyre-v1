# turn.engine_switched

The engine of a chat changed (the quiet line in the thread)

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
  threadId: string;
  agentId: string;
  from: string;
  to: string;
  handoffTurns: number;
  by: string;
};
```
