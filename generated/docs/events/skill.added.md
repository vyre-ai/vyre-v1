# skill.added

A skill was added to the Space library or to one agent

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
  tier: "space" | "agent";
  agentId?: string;
  source: string;
  by: string;
};
```
