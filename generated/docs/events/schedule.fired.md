# schedule.fired

A schedule fired its call

| | |
|---|---|
| Module | scheduler-api |
| Schema version | 1 |
| Subject | entity at /scheduleId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | run_logs |

## Payload

```ts
type Payload = {
  scheduleId: string;
  owner: {
    kind: "automation" | "journey" | "agent_routine" | "campaign" | "gate" | "task" | "system";
    id: string;
  };
  runId?: string;
  scheduledFor: number;
  late: boolean;
};
```
