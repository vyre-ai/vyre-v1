# health.paused

An unhealthy dependency paused automations, sync or sends

| | |
|---|---|
| Module | health |
| Schema version | 1 |
| Subject | entity at /key |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  key: string;
  paused: Array<"automations" | "sync" | "sends">;
  reason: string;
};
```
