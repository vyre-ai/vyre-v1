# agent.routine_run_started

A routine run started now, as the routine owner

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
  runId: string;
  ownerId: string;
  requestedBy: string;
};
```
