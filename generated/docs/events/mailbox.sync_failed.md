# mailbox.sync_failed

A mailbox sync failed; the owner sees the next step

| | |
|---|---|
| Module | mail |
| Schema version | 1 |
| Subject | mailbox at /mailboxId |
| Visibility | participants |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | sync.attention |
| Retention | default |

## Payload

```ts
type Payload = {
  mailboxId: string;
  reason: string;
};
```
