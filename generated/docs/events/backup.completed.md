# backup.completed

A backup finished and was written to the target

| | |
|---|---|
| Module | backup |
| Schema version | 1 |
| Subject | entity at /backupId |
| Visibility | space |
| Label | none |
| Replay | stub |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  backupId: string;
  seq: number;
  sizeBytes: number;
};
```
