# agent.routine_changed

A routine was created, changed or deleted

| | |
|---|---|
| Module | agents |
| Schema version | 1 |
| Subject | agent at /agentId |
| Visibility | owner |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  agentId: string;
  routineId: string;
  op: "created" | "updated" | "deleted";
};
```
