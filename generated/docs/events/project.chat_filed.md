# project.chat_filed

A private chat was filed under a project (it stays private)

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
  threadId: string;
};
```
