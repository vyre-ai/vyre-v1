# file.redact_ready

A file an agent asked for was reviewed: the agent is woken to read it

| | |
|---|---|
| Module | files |
| Schema version | 1 |
| Subject | file at /fileId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  requestId: string;
  fileId: string;
  name: string;
  by: string;
  agentId?: string;
  actingFor?: string;
  threadId?: string;
  taskId?: string;
};
```
