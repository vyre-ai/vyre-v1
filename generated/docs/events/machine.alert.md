# machine.alert

A machine needs a look: disk nearly full, memory pressure, offline with pinned work or a failed backup (once while it lasts; the Inbox line)

| | |
|---|---|
| Module | machines |
| Schema version | 1 |
| Subject | entity at /machineId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | machine.alert |
| Retention | default |

## Payload

```ts
type Payload = {
  alertId: string;
  machineId: string;
  kind: "disk_low" | "memory_pressure" | "offline_pinned" | "update_waiting" | "backup_failed";
  title: string;
  detail: string;
};
```
