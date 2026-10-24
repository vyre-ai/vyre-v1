# backup.config_changed

Backup target or schedule changed

| | |
|---|---|
| Module | backup |
| Schema version | 1 |
| Subject | entity at /target |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  target: string;
  schedule: string;
};
```
