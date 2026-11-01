# crew.job_pushed

A crew's merged work was pushed to the project's remote

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
};
```
