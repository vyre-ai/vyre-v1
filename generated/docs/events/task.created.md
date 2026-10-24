# task.created

A task was created

| | |
|---|---|
| Module | tasks |
| Schema version | 1 |
| Subject | task at /taskId |
| Visibility | participants |
| Label | subject |
| Replay | pure |
| Automation trigger | A task is created |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  taskId: string;
  kind: "work" | "approve" | "review" | "answer" | "unblock" | "signature";
  title: string;
  assigned: {
    kind: "person" | "agent" | "group" | "role" | "automation";
    id: string;
  };
  recordId?: string;
  source?: {
    kind: "chat" | "run" | "gate" | "journey" | "manual";
    id: string;
  };
};
```
