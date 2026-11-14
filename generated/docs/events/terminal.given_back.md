# terminal.given_back

The keyboard of a terminal went back to the agent (handed back, or nobody used it for 15 minutes)

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
