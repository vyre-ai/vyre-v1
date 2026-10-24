# run.succeeded

A Run finished

| | |
|---|---|
| Module | runs |
| Schema version | 1 |
| Subject | run at /runId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | A run succeeds |
| Notification | none |
| Retention | run_logs |

## Payload

```ts
type Payload = {
  runId: string;
  kind: "automation" | "automation_test" | "journey" | "journey_migrate" | "routine" | "campaign" | "deployment" | "runbook" | "wait" | "terminal" | "replay" | "other";
  summary?: string;
  costMicros: number;
};
```
