# goal.reported

The lead agent posted a goal update

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
  wakeId?: string;
  by: string;
};
```
