# task.delegated

A task was handed over with a note

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
  from: string;
  to: {
    kind: "person" | "agent" | "group" | "role" | "automation";
    id: string;
  };
  passedTo: {
    kind: "person" | "agent" | "group" | "role" | "automation";
    id: string;
  };
};
```
