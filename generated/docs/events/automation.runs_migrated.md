# automation.runs_migrated

Active runs moved to a later definition version without replaying finished steps

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
| Retention | audit |

## Payload

```ts
type Payload = {
  automationId: string;
  toVersion: number;
  runIds: Array<string>;
};
```
