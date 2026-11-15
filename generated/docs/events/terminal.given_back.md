# terminal.given_back

The keyboard of a terminal was handed back to the agent by the person who held it (a hold that ran out after 15 quiet minutes is read as over and emits nothing)

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
  agentId?: string;
  agentName?: string;
  agentOwner?: string;
};
```
