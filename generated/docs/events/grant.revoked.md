# grant.revoked

A grant was removed

| | |
|---|---|
| Module | access |
| Schema version | 1 |
| Subject | entity at /grantId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  grantId: string;
  subject: {
    kind: "person" | "agent" | "actor" | "service" | "group" | "role" | "link";
    id: string;
  };
  resource: {
    type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "campaign" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain";
    id: string;
  };
  reason?: string;
};
```
