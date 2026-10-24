# github.issue_assigned

An issue was assigned to an agent

| | |
|---|---|
| Module | github |
| Schema version | 1 |
| Subject | record at /recordId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  recordId: string;
  taskId: string;
  agentId: string;
};
```
