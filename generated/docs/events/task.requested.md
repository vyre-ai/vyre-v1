# task.requested

A request (Approve, Review, Answer or Unblock) is waiting on someone

| | |
|---|---|
| Module | tasks |
| Schema version | 1 |
| Subject | task at /taskId |
| Visibility | participants |
| Label | subject |
| Replay | pure |
| Automation trigger | no |
| Notification | approval.requested |
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
  expiresAt?: number;
};
```
