# goal.extended

The deadline of a goal moved

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
  deadline: number;
  by: string;
};
```
