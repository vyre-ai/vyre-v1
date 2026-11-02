# agent.job_queued

A mention or a task is waiting for an outside agent

| | |
|---|---|
| Module | agents |
| Schema version | 1 |
| Subject | agent at /agentId |
| Visibility | participants |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  agentId: string;
  jobId: string;
  kind: string;
};
```
