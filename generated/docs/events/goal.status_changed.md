# goal.status_changed

A goal changed status

| | |
|---|---|
| Module | goals |
| Schema version | 1 |
| Subject | thread at /threadId |
| Visibility | participants |
| Label | subject |
| Replay | pure |
| Automation trigger | A goal changes status |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  goalId: string;
  threadId: string;
  from: "draft" | "planning" | "active" | "waiting" | "stuck" | "paused" | "done" | "missed" | "stopped";
  to: "draft" | "planning" | "active" | "waiting" | "stuck" | "paused" | "done" | "missed" | "stopped";
  reason?: string;
};
```
