# agent.config_changed

AGENT.md, agent.toml or the agent record changed (a new version was saved)

| | |
|---|---|
| Module | agents |
| Schema version | 1 |
| Subject | agent at /agentId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | An agent configuration changes |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  agentId: string;
  fields: Array<string>;
  versionId?: string;
  by: string;
};
```
