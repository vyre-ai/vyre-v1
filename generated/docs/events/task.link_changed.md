# task.link_changed

A record or file link, or a dependency, was added or removed

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
  op: "added" | "removed";
  linkKind: "record" | "file" | "dependency";
  linkId: string;
};
```
