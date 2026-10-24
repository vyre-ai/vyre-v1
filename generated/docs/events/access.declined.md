# access.declined

An access request was declined; the note goes back to the requester

| | |
|---|---|
| Module | access |
| Schema version | 1 |
| Subject | entity at /requestId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | access.decided |
| Retention | default |

## Payload

```ts
type Payload = {
  requestId: string;
  resource: {
    type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "campaign" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain";
    id: string;
  };
  requester: string;
  note?: string;
};
```
