# terminal.command_finished

A command finished (exit code and duration only, never the command or output)

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
| Retention | logs |

## Payload

```ts
type Payload = {
  terminalId: string;
  exitCode: number | null;
  durationMs: number;
  by: string;
  runId?: string;
};
```
