# access.granted

An access request was approved

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
| Retention | audit |

## Payload

```ts
type Payload = {
  requestId: string;
  resource: {
    type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "campaign" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain";
    id: string;
  };
  level: "view" | "use" | "edit" | "manage";
  requester: string;
  grantId: string;
};
```
