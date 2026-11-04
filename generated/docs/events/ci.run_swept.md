# ci.run_swept

The sweeper deleted a machine: past its time limit, or with no live run

| | |
|---|---|
| Module | ci |
| Schema version | 1 |
| Subject | entity at /dropletId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  runId: string | null;
  dropletId: string;
  reason: "too_long" | "no_run";
  costUsd: number;
};
```
