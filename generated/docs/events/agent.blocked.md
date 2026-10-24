# agent.blocked

An agent is blocked (login, key, site down) and asks for what would unblock it

| | |
|---|---|
| Module | engine |
| Schema version | 1 |
| Subject | thread at /threadId |
| Visibility | participants |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | agent.blocked |
| Retention | default |

## Payload

```ts
type Payload = {
  agentId: string;
  threadId: string;
  turnId?: string;
  taskId: string;
  what: string;
};
```
