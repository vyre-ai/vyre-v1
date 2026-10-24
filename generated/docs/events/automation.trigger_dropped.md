# automation.trigger_dropped

A trigger event was ignored: self-trigger, chain depth 8 or paused

| | |
|---|---|
| Module | automations |
| Schema version | 1 |
| Subject | automation at /automationId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | run_logs |

## Payload

```ts
type Payload = {
  automationId: string;
  eventId: string;
  reason: "self_trigger" | "depth_limit" | "paused" | "filter_error";
};
```
