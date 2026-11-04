# access.shared_with

A person was told an item was shared with them (when the sharer asked for that)

| | |
|---|---|
| Module | access |
| Schema version | 1 |
| Subject | entity at /to |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | item.shared |
| Retention | audit |

## Payload

```ts
type Payload = {
  to: string;
  resource: {
    type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain" | "calendar";
    id: string;
  };
  level: "view" | "use" | "edit" | "manage";
  byName: string;
  title: string;
  message?: string;
};
```
