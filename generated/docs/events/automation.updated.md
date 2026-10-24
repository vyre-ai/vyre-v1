# automation.updated

An Automation definition or settings changed; a definition change saves a version

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
  version: number;
  fields: Array<string>;
};
```
