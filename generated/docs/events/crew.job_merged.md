# crew.job_merged

A teammate's branch was landed in the project repository

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
  branch: string;
  landed: boolean;
};
```
