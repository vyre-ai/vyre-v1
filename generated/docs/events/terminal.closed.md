# terminal.closed

A terminal session was closed

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
};
```
