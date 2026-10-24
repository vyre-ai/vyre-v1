# schedule.missed

A schedule was missed while the server was down and handled by its if-missed rule

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
  scheduledFor: number;
  handling: "ran_once" | "skipped";
  note?: string;
};
```
