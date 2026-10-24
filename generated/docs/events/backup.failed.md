# backup.failed

A backup failed

| | |
|---|---|
| Module | backup |
| Schema version | 1 |
| Subject | entity at /reason |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | health.degraded |
| Retention | default |

## Payload

```ts
type Payload = {
  backupId?: string;
  reason: string;
};
```
