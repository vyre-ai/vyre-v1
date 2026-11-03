# network.machine_alert

A machine needs a look: disk nearly full, memory pressure, offline with pinned work or a failed backup

| | |
|---|---|
| Module | network |
| Schema version | 1 |
| Subject | entity at /serverId |
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
  serverId: string;
  kind: "disk" | "memory" | "offline" | "backup" | "update";
  title: string;
  detail: string;
};
```
