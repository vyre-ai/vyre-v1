# workflow_job.completed

A workflow job finished, on any runner

| | |
|---|---|
| Module | github |
| Schema version | 1 |
| Subject | entity at /repo |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  repo: string;
  jobId: number;
  runId: number;
  name: string;
  labels: Array<string>;
  conclusion: string;
  runnerName?: string;
};
```
