# goal.woken

The lead agent of a goal is due a turn in the goal chat (check-in, a task done, the number moved, an answer)

| | |
|---|---|
| Module | goals |
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
  goalId: string;
  threadId: string;
  wakeId: string;
  attempt: number;
  reason: string;
  leadAgentId: string;
  owner: string;
};
```
