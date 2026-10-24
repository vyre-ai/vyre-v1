# run.failed

A Run failed; it lands in the owner Needs you

| | |
|---|---|
| Module | runs |
| Schema version | 1 |
| Subject | run at /runId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | A run fails |
| Notification | run.failed |
| Retention | run_logs |

## Payload

```ts
type Payload = {
  runId: string;
  kind: "automation" | "automation_test" | "journey" | "journey_migrate" | "routine" | "campaign" | "deployment" | "runbook" | "wait" | "terminal" | "replay" | "other";
  step?: string;
  code: string;
  message: string;
  owner: string;
  consecutive?: number;
};
```
