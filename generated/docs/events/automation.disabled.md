# automation.disabled

An Automation was turned off or paused

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
| Retention | default |

## Payload

```ts
type Payload = {
  automationId: string;
  reason?: string;
};
```
