# terminal.run

Run a command in a session and wait for it; secrets only as #Handle.field; output is scrubbed

| | |
|---|---|
| Module | terminal |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | terminal.use |
| Grant level | use |
| Risk | high |
| Resource | space |
| Gate | approve when terminal.is_danger(input.command) |
| Idempotency | key |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/terminal/run |
| MCP tool | terminal_run (terminal) |
| CLI | none |
| Emits | terminal.opened, terminal.command_finished |

## Input

```ts
type In = {
  command: string;
  terminalId?: string;
  session?: string;
  host?: "agent_computer" | "device";
  agentId?: string;
  cwd?: string;
  timeoutSec?: number;
  env?: Record<string, string>;
  background?: boolean;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  terminalId: string;
  commandId?: number;
  exitCode: number | null;
  output: string;
  truncated: boolean;
  durationMs: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_approval
- permission.no_grant
- permission.role_lacks_permission
- provider.unavailable
- timeout.deadline
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "agentId": "agt_a1b2c3",
    "background": true,
    "command": "example",
    "cwd": "example",
    "env": {},
    "host": "agent_computer",
    "idempotencyKey": "idem_1",
    "session": "example",
    "terminalId": "trm_a1b2c3",
    "timeoutSec": 1
  },
  "output": {
    "commandId": 1,
    "durationMs": 1,
    "exitCode": 1,
    "output": "example",
    "terminalId": "trm_a1b2c3",
    "truncated": true
  }
}
```
