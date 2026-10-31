# thread.deleted

A person deleted a chat only they were in: hidden everywhere, kept for Undo and the audit trail until the retention purge

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
