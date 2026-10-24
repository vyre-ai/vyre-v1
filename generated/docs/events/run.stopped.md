# run.stopped

A Run was stopped by its owner or a Manage holder

| | |
|---|---|
| Module | runs |
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
  runId: string;
  by: string;
  reason?: string;
};
```
