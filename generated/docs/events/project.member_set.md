# project.member_set

A person or agent was given a project role

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
  principal: string;
  role: "lead" | "member" | "reviewer" | "guest";
  previous?: "lead" | "member" | "reviewer" | "guest";
};
```
