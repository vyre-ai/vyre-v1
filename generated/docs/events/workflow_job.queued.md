# workflow_job.queued

A workflow job is waiting for a runner; fork says whether its run came from another repository (unknown counts as a fork)

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
  fork: "no" | "yes" | "unknown";
};
```
