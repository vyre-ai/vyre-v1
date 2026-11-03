# task.due

A due date reached its holder: the day it is due began in their time zone, or the time passed

| | |
|---|---|
| Module | tasks |
| Schema version | 1 |
| Subject | task at /taskId |
| Visibility | participants |
| Label | subject |
| Replay | pure |
| Automation trigger | A task is due |
| Notification | task.due |
| Retention | default |

## Payload

```ts
type Payload = {
  taskId: string;
  title: string;
  due: number;
  at: "day" | "time";
  holder: {
    kind: "person" | "agent" | "group" | "role" | "automation";
    id: string;
  };
};
```
