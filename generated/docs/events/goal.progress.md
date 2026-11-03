# goal.progress

The source of a goal was read

| | |
|---|---|
| Module | goals |
| Schema version | 1 |
| Subject | thread at /threadId |
| Visibility | participants |
| Label | subject |
| Replay | pure |
| Automation trigger | A goal moves |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  goalId: string;
  threadId: string;
  ok: boolean;
  value?: number;
  prev?: number;
  target?: number;
  error?: string;
};
```
