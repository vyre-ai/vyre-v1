# mailbox.created

A shared, agent or service mailbox was created

| | |
|---|---|
| Module | mail |
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
  kind: "personal" | "shared" | "agent" | "service";
  address: string;
};
```
