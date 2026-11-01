# crew.job_started

A teammate started on a brief in its own thread and its own branch

| | |
|---|---|
| Module | engine |
| Schema version | 1 |
| Subject | thread at /leadThreadId |
| Visibility | participants |
| Label | subject |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  jobId: string;
  threadId: string;
  leadThreadId: string;
  projectId: string;
  agentId: string;
  branch: string;
};
```
