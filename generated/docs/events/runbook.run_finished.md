# runbook.run_finished

A runbook run ended

| | |
|---|---|
| Module | runbooks |
| Schema version | 1 |
| Subject | file at /fileId |
| Visibility | space |
| Label | subject |
| Replay | stub |
| Automation trigger | A runbook finishes |
| Notification | none |
| Retention | run_logs |

## Payload

```ts
type Payload = {
  runId: string;
  fileId: string;
  state: "queued" | "running" | "succeeded" | "failed" | "stopped";
  exit?: number;
  ms: number;
  failedBlock?: string;
};
```
