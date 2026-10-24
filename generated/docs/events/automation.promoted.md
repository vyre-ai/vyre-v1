# automation.promoted

A Personal Automation became a Space Automation with access granted to the automation itself

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
  ownerId: string;
  grants: number;
  keysReplaced: number;
};
```
