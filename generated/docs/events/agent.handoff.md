# agent.handoff

An agent handed work to another agent, in a new linked thread

| | |
|---|---|
| Module | chat |
| Schema version | 1 |
| Subject | thread at /toThreadId |
| Visibility | participants |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  fromThreadId: string;
  toThreadId: string;
  fromAgentId: string;
  toAgentId: string;
  depth: number;
};
```
