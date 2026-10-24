# agent.template_applied

The Agent template was applied

| | |
|---|---|
| Module | agents |
| Schema version | 1 |
| Subject | entity at /scope |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  scope: string;
  agents: number;
  suggestions: number;
  by: string;
};
```
