# wait.registered

A background wait was registered

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
  on: {
    event: string;
    filter?: unknown;
  } | {
    run: string;
  } | {
    at: number;
  };
  expiresAt: number;
};
```
