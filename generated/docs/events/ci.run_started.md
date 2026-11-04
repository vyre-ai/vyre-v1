# ci.run_started

A cloud machine was made for a job and the runner is on it

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
  dropletId: string;
  size: string;
};
```
