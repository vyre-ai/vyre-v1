# goal.ended

A goal ended: done, missed or stopped, with its summary

| | |
|---|---|
| Module | goals |
| Schema version | 1 |
| Subject | thread at /threadId |
| Visibility | participants |
| Label | subject |
| Replay | pure |
| Automation trigger | A goal ends |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  goalId: string;
  threadId: string;
  outcome: "done" | "missed" | "stopped";
  summary: string;
};
```
