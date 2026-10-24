# task.sent_back

A reviewer or approver sent work back with a note

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
  by: string;
  note: string;
  reviewLoops: number;
};
```
