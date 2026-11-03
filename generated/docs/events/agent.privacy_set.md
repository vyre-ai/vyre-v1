# agent.privacy_set

An agent became private to its person (their assistant, an outside agent) or stopped being so; access names it as its person to everyone else

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
  ownerId: string;
  private: boolean;
};
```
