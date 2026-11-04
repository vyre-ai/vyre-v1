# ci.job_refused

A job asked for a runner and was refused, with the reason in plain words

| | |
|---|---|
| Module | ci |
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
  reason: string;
  code: "fork_with_secrets" | "cap_reached" | "not_enabled" | "no_key" | "runner_unverified";
};
```
