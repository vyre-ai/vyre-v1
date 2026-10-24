# task.transitioned

A task changed status

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
  kind: "work" | "approve" | "review" | "answer" | "unblock" | "signature";
  from: "todo" | "doing" | "in_review" | "awaiting_approval" | "done" | "canceled";
  to: "todo" | "doing" | "in_review" | "awaiting_approval" | "done" | "canceled";
  note?: string;
};
```
