# task.withdrawn

A request or a task was withdrawn because its source chat or run stopped, the item changed or someone let it go

| | |
|---|---|
| Module | tasks |
| Schema version | 1 |
| Subject | task at /taskId |
| Visibility | participants |
| Label | subject |
| Replay | pure |
| Automation trigger | A task is withdrawn |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  taskId: string;
  note: string;
  sourceKind?: string;
  sourceId?: string;
};
```
