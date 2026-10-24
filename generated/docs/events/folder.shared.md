# folder.shared

A folder was shared or unshared; everything in it follows

| | |
|---|---|
| Module | access |
| Schema version | 1 |
| Subject | folder at /folderId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  folderId: string;
  subject: {
    kind: "person" | "agent" | "actor" | "service" | "group" | "role" | "link";
    id: string;
  };
  level?: "view" | "use" | "edit" | "manage";
  removed: boolean;
};
```
