# task.archived

A task was put away with its reason; it is not deleted and can be put back

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
  title: string;
  code: "hand" | "asked" | "passed" | "gone" | "quiet";
  why?: string;
  by: string;
};
```
