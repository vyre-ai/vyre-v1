# task.completed

A task reached Done

| | |
|---|---|
| Module | tasks |
| Schema version | 1 |
| Subject | task at /taskId |
| Visibility | participants |
| Label | subject |
| Replay | pure |
| Automation trigger | A task is completed |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  taskId: string;
  kind: "work" | "approve" | "review" | "answer" | "unblock" | "signature";
  recordId?: string;
  source?: {
    kind: "chat" | "run" | "gate" | "journey" | "manual";
    id: string;
  };
};
```
