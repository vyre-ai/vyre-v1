# task.withdrawn

A request was withdrawn because its source chat or run stopped or the item changed

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
  note: string;
  sourceKind?: string;
  sourceId?: string;
};
```
