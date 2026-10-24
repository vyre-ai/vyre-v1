# grant.created

A grant was given to a person, group, role or link

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
    type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "campaign" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain" | "calendar";
    id: string;
  };
  level: "view" | "use" | "edit" | "manage";
  source?: string;
};
```
