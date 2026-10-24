# helper.started

A helper sub-task thread started under a chat

| | |
|---|---|
| Module | chat |
| Schema version | 1 |
| Subject | thread at /helperThreadId |
| Visibility | participants |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  helperThreadId: string;
  parentThreadId: string;
  agentId: string;
  model?: string;
};
```
