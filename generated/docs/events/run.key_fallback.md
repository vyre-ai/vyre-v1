# run.key_fallback

A lost key fell back to the backup key (the Run chat records it)

| | |
|---|---|
| Module | runs |
| Schema version | 1 |
| Subject | run at /runId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | run_logs |

## Payload

```ts
type Payload = {
  runId: string;
  step?: string;
  fromKey: string;
  toKey?: string;
  reason: string;
};
```
