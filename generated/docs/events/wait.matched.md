# wait.matched

A wait matched an event, a Run or a time and woke its thread

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
  matchedEventId?: string;
};
```
