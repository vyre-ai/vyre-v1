# mailbox.connected

A mailbox connection was created (Pending until the first sync); one notice per member

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
  memberId?: string;
  provider: "google" | "microsoft" | "imap" | "inbound_only";
  auto: boolean;
};
```
