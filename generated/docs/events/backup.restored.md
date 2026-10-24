# backup.restored

A backup was restored; tombstones were replayed before the Space opened

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
  tombstonesReplayed: number;
};
```
