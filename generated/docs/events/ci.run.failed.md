# ci.run.failed

A machine could not be made for a job, or it was lost before the job ran

| | |
|---|---|
| Module | ci |
| Schema version | 1 |
| Subject | entity at /runId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  runId: string;
  repo: string;
  jobId: number;
  reason: string;
};
```
