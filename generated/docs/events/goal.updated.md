# goal.updated

Fields of a goal changed (finish line, deadline, budget, rhythm, helpers, links, permissions)

| | |
|---|---|
| Module | goals |
| Schema version | 1 |
| Subject | thread at /threadId |
| Visibility | participants |
| Label | subject |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  goalId: string;
  threadId: string;
  fields: Array<string>;
  by: string;
};
```
