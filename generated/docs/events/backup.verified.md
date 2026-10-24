# backup.verified

A backup restored cleanly into a scratch directory

| | |
|---|---|
| Module | backup |
| Schema version | 1 |
| Subject | entity at /backupId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  backupId: string;
};
```
