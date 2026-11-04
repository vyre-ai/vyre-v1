# ci.run.finished

A job ended and its machine was deleted; the cost is recorded

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
  conclusion: string;
  costUsd: number;
  minutes: number;
};
```
