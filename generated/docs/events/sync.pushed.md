# sync.pushed

A change was written to the remote app

| | |
|---|---|
| Module | connectors |
| Schema version | 1 |
| Subject | record at /recordId |
| Visibility | space |
| Label | subject |
| Replay | stub |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  syncTypeId: string;
  recordId: string;
  outboxId: string;
};
```
