# automation.run_started

An Automation run started from a trigger, by hand or in test mode

| | |
|---|---|
| Module | automations |
| Schema version | 1 |
| Subject | automation at /automationId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | An automation run starts |
| Notification | none |
| Retention | run_logs |

## Payload

```ts
type Payload = {
  automationId: string;
  runId: string;
  trigger: string;
  version: number;
  test: boolean;
  depth: number;
  origin?: string;
};
```
