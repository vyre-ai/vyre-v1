# project.created

A project was made with its channel, folder and empty plan

| | |
|---|---|
| Module | projects |
| Schema version | 1 |
| Subject | project at /projectId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | A project is created |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  projectId: string;
  recordId: string;
  type: string;
  channelId: string;
  folderId: string;
  source: "new" | "channel" | "journey" | "template";
};
```
