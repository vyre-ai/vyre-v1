# run.waiting

A Run is waiting for approval, background work or a key

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
  reason: "approval" | "background" | "key";
  taskId?: string;
  on?: string;
};
```
