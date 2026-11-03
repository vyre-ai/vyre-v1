# task.nudged

A step sat with someone too long, so they (or the person behind it) were reminded

| | |
|---|---|
| Module | tasks |
| Schema version | 1 |
| Subject | task at /taskId |
| Visibility | participants |
| Label | subject |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  taskId: string;
  title: string;
  why: "unblock_waiting" | "idle_agent" | "waiting_on_decision";
  notify: string;
};
```
