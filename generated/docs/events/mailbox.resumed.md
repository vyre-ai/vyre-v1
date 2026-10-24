# mailbox.resumed

The owner resumed a mailbox

| | |
|---|---|
| Module | mail |
| Schema version | 1 |
| Subject | mailbox at /mailboxId |
| Visibility | participants |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  mailboxId: string;
};
```
