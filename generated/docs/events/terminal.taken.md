# terminal.taken

A person took the keyboard of a terminal (the agent is told, its commands are refused until it is handed back). When it is someone other than the agent's owner, the payload names the agent and its owner so the owner is told in their chat

| | |
|---|---|
| Module | terminal |
| Schema version | 1 |
| Subject | terminal at /terminalId |
| Visibility | participants |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  terminalId: string;
  by: string;
  from?: string;
  agentId?: string;
  agentName?: string;
  agentOwner?: string;
};
```
