# task.assigned

A slot (Assigned, Reviewer or Approver) was set or changed

| | |
|---|---|
| Module | tasks |
| Schema version | 1 |
| Subject | task at /taskId |
| Visibility | participants |
| Label | subject |
| Replay | pure |
| Automation trigger | A task is assigned |
| Notification | task.assigned |
| Retention | default |

## Payload

```ts
type Payload = {
  taskId: string;
  slot: "assigned" | "reviewer" | "approver";
  to: ({
    kind: "person" | "agent" | "group" | "role" | "automation";
    id: string;
  }) | null;
  from: ({
    kind: "person" | "agent" | "group" | "role" | "automation";
    id: string;
  }) | null;
};
```
