# health.changed

A health check changed state

| | |
|---|---|
| Module | health |
| Schema version | 1 |
| Subject | entity at /key |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | A health check changes state |
| Notification | health.degraded |
| Retention | default |

## Payload

```ts
type Payload = {
  key: string;
  from: "healthy" | "degraded" | "down";
  to: "healthy" | "degraded" | "down";
  detail?: string;
};
```
