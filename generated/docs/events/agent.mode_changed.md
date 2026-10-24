# agent.mode_changed

An agent switched between Leading and Listening in a thread

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
  mode: string;
  by: string;
};
```
