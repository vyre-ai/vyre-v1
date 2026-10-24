# conflict.confirmation_needed

A protected field conflict waits for the person to confirm or choose

| | |
|---|---|
| Module | conflicts |
| Schema version | 1 |
| Subject | entity at /conflictId |
| Visibility | owner |
| Label | subject |
| Replay | pure |
| Automation trigger | no |
| Notification | conflict.needs_you |
| Retention | default |

## Payload

```ts
type Payload = {
  conflictId: string;
  taskId: string;
  plainChoice: boolean;
};
```
