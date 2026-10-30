# skill.changed

A skill was turned off or on

| | |
|---|---|
| Module | agents |
| Schema version | 1 |
| Subject | entity at /name |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  name: string;
  agentId?: string;
  enabled: boolean;
  by: string;
};
```
