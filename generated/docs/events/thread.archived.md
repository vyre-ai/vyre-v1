# thread.archived

A person archived a chat: it left their list only

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
| Retention | default |

## Payload

```ts
type Payload = {
  person: string;
  threadId: string;
};
```
