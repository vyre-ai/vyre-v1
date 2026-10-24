# task.escalated

A task passed to a delegate or role after its timeout

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
  to: {
    kind: "person" | "agent" | "group" | "role" | "automation";
    id: string;
  };
  reason: "timeout" | "manual" | "away";
};
```
