# turn.cancelled

A turn was cancelled by Stop or Interrupt

| | |
|---|---|
| Module | engine |
| Schema version | 1 |
| Subject | thread at /threadId |
| Visibility | participants |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  turnId: string;
  threadId: string;
  agentId: string;
  by: string;
};
```
