# schedule.created

A schedule was created

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
| Retention | default |

## Payload

```ts
type Payload = {
  scheduleId: string;
  owner: {
    kind: "automation" | "journey" | "agent_routine" | "campaign" | "gate" | "task" | "system";
    id: string;
  };
  nextAt?: number;
};
```
