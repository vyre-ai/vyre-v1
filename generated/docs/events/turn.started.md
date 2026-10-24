# turn.started

A turn started on a host or device

| | |
|---|---|
| Module | engine |
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
  turnId: string;
  threadId: string;
  agentId: string;
  placement: string;
  engine: string;
  model: string;
  accountRef?: string;
};
```
