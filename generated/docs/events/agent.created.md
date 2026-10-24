# agent.created

An agent was created

| | |
|---|---|
| Module | agents |
| Schema version | 1 |
| Subject | agent at /agentId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | An agent is created |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  agentId: string;
  name: string;
  ownerId: string;
  templateVersion: number;
};
```
