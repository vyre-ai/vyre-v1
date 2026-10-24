# wait.canceled

A wait was canceled: its subject record was deleted or left the stage, or the Run was stopped

| | |
|---|---|
| Module | scheduler-api |
| Schema version | 1 |
| Subject | run at /runId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | run_logs |

## Payload

```ts
type Payload = {
  waitId: string;
  runId: string;
  reason: "subject_deleted" | "left_stage" | "stopped" | "manual";
};
```
