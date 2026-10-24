# mailbox.privacy_changed

A mailbox moved between private, shared with the Space and shared with chosen people

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
  privacy: "private" | "space" | "people";
};
```
