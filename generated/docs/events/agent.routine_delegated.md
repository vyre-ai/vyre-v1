# agent.routine_delegated

A routine was handed to another owner, or handed back

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
  from: string;
  to: string;
  undo: boolean;
};
```
