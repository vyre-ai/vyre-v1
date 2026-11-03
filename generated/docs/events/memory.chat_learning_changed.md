# memory.chat_learning_changed

Don't remember this chat was turned on or off

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
  remember: boolean;
  by: string;
};
```
