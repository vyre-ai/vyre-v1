# skill.removed

A skill was removed from the Space library or from one agent

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
  by: string;
};
```
