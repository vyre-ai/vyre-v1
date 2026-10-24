# agent.limit_hit

An agent hit a limit from agent.toml or a Space cap; the turn stopped

| | |
|---|---|
| Module | engine |
| Schema version | 1 |
| Subject | entity at /agentId |
| Visibility | participants |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | limit.hit |
| Retention | default |

## Payload

```ts
type Payload = {
  agentId: string;
  threadId?: string;
  turnId?: string;
  limit: "run" | "day" | "month" | "turns" | "time";
  used: number;
  cap: number;
  taskId?: string;
};
```
