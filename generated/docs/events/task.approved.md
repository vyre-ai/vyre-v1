# task.approved

A review or approval was granted

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
  by: string;
  forPerson?: string;
};
```
