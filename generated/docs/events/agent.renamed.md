# agent.renamed

An agent's name changed; access gives the agent's principal the new name, so every reader of the people directory (mentions, share sheets, rows) shows it

| | |
|---|---|
| Module | agents |
| Schema version | 1 |
| Subject | agent at /agentId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  agentId: string;
  name: string;
};
```
