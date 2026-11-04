# project.item_unlinked

A link was taken off a project

| | |
|---|---|
| Module | projects |
| Schema version | 1 |
| Subject | project at /projectId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  projectId: string;
  linkId: string;
  kind: "record" | "file" | "chat" | "task" | "artifact" | "mail_thread" | "calendar_event" | "github.pr" | "github.commit" | "ci.run" | "url";
  ref: string;
  by: string;
};
```
