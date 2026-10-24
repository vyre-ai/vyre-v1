# github.event_received

A verified GitHub delivery arrived

| | |
|---|---|
| Module | github |
| Schema version | 1 |
| Subject | entity at /deliveryId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  deliveryId: string;
  event: "ping" | "installation" | "push" | "pull_request" | "issues" | "check_run" | "workflow_run";
  action?: string;
  repo?: string;
};
```
