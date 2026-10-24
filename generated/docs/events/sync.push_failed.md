# sync.push_failed

A change could not be written to the remote app after retries

| | |
|---|---|
| Module | connectors |
| Schema version | 1 |
| Subject | record at /recordId |
| Visibility | space |
| Label | subject |
| Replay | stub |
| Automation trigger | A sync push fails |
| Notification | sync.attention |
| Retention | default |

## Payload

```ts
type Payload = {
  syncTypeId: string;
  type: string;
  recordId: string;
  outboxId: string;
  error: string;
  attempts: number;
};
```
