# update.failed

A server update failed and the server rolled back

| | |
|---|---|
| Module | updates |
| Schema version | 1 |
| Subject | entity at /to |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | health.degraded |
| Retention | default |

## Payload

```ts
type Payload = {
  to: string;
  reason: string;
};
```
