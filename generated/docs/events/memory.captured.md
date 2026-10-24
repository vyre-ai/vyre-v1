# memory.captured

Capture ran for a thread

| | |
|---|---|
| Module | memory |
| Schema version | 1 |
| Subject | thread at /threadId |
| Visibility | participants |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | memory |

## Payload

```ts
type Payload = {
  threadId: string;
  proposed: number;
  merged: number;
};
```
