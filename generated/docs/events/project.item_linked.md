# project.item_linked

Something was linked to a project, by a person, an agent or a rule

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
  source: "manual" | "agent" | "rule";
  ruleId?: string;
  by: string;
};
```
