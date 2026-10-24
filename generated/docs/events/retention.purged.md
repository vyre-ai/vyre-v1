# retention.purged

A retention job removed or compacted data of one kind (counts only)

| | |
|---|---|
| Module | governance |
| Schema version | 1 |
| Subject | entity at /kind |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  kind: "trash" | "run_logs" | "transcripts" | "audit" | "file_versions" | "logs" | "events" | "backups" | "memory" | "records";
  removed: number;
  skippedOnHold: number;
};
```
