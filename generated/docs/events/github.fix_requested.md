# github.fix_requested

The author agent was asked to fix a failing check

| | |
|---|---|
| Module | github |
| Schema version | 1 |
| Subject | record at /recordId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  recordId: string;
  taskId: string;
  attempt: number;
};
```
