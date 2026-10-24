# message.edited

A message was edited

| | |
|---|---|
| Module | chat |
| Schema version | 1 |
| Subject | thread at /threadId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | transcripts |

## Payload

```ts
type Payload = {
  messageId: string;
  threadId: string;
};
```
