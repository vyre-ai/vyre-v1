# thread.restored

A person undid the delete of their chat

| | |
|---|---|
| Module | chat |
| Schema version | 1 |
| Subject | entity at /threadId |
| Visibility | owner |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  person: string;
  threadId: string;
};
```
