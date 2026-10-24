# terminal.opened

A terminal session was opened

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
  host: string;
  agentId?: string;
  by: string;
};
```
