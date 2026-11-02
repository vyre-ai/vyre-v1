# task.children_settled

The children of a task need its holder: all finished, or one is blocked or asks

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
  reason: "finished" | "blocked" | "asked";
  childId?: string;
};
```
