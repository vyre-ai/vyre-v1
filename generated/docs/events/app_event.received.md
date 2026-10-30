# app_event.received

Something happened in a connected app: a polling trigger found a new item, or a webhook trigger took a delivery

| | |
|---|---|
| Module | automations |
| Schema version | 1 |
| Subject | entity at /app |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | run_logs |

## Payload

```ts
type Payload = {
  app: string;
  trigger: string;
  itemId: string;
  item: unknown;
  source: "poll" | "webhook";
  at: number;
};
```
