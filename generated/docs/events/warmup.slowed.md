# warmup.slowed

Warmup slowed a mailbox after bounces, spam placement or low replies

| | |
|---|---|
| Module | campaigns |
| Schema version | 1 |
| Subject | mailbox at /mailboxId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  mailboxId: string;
  reason: string;
};
```
