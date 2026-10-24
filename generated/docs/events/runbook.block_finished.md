# runbook.block_finished

One block of a runbook finished

| | |
|---|---|
| Module | runbooks |
| Schema version | 1 |
| Subject | file at /fileId |
| Visibility | space |
| Label | subject |
| Replay | stub |
| Automation trigger | no |
| Notification | none |
| Retention | run_logs |

## Payload

```ts
type Payload = {
  runId: string;
  fileId: string;
  blockId: string;
  exit: number;
  ms: number;
};
```
