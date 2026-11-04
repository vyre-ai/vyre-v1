# hook.blocked

A hook stopped a message, a tool call, an outward act or a helper

| | |
|---|---|
| Module | hooks |
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
  hookId: string;
  event: string;
  threadId: string;
  agentId: string;
  reason: string;
  scope: string;
  by: string;
};
```
