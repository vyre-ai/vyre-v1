# run.undone

The writes of a Run were undone where possible

| | |
|---|---|
| Module | runs |
| Schema version | 1 |
| Subject | run at /runId |
| Visibility | space |
| Label | none |
| Replay | stub |
| Automation trigger | no |
| Notification | none |
| Retention | run_logs |

## Payload

```ts
type Payload = {
  runId: string;
  undone: number;
  skipped: number;
};
```
