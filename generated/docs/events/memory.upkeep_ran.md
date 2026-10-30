# memory.upkeep_ran

An upkeep run finished (counts and cost only)

| | |
|---|---|
| Module | memory |
| Schema version | 1 |
| Subject | entity at /runId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | memory |

## Payload

```ts
type Payload = {
  runId: string;
  merged: number;
  flagged: number;
  stale: number;
  created: number;
  corrected: number;
  deleted: number;
  tidied: number;
  modelUsed: boolean;
  costMicros: number;
  stopped?: string;
};
```
