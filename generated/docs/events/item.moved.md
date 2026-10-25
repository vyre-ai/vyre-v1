# item.moved

An item moved into or out of a folder

| | |
|---|---|
| Module | access |
| Schema version | 1 |
| Subject | entity at /resource/id |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  resource: {
    type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "campaign" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain" | "calendar";
    id: string;
  };
  fromFolderId?: string | string;
  toFolderId?: string | string;
};
```
