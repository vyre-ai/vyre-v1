# terminal.open

Open a terminal session on an agent computer or on your own computer (the device daemon)

| | |
|---|---|
| Module | terminal |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | terminal.use |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/terminal/open |
| MCP tool | terminal_open (terminal) |
| CLI | vyre terminal open |
| Emits | terminal.opened |

## Input

```ts
type In = {
  host: "agent_computer" | "device";
  agentId?: string;
  computerId?: string;
  deviceId?: string;
  name?: string;
  cwd?: string;
  cols?: number;
  rows?: number;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  terminal: {
    terminalId: string;
    name: string;
    host: "agent_computer" | "space_server" | "device";
    hostTitle: string;
    agentId?: string;
    computerId?: string;
    deviceId?: string;
    cwd: string;
    state: "running" | "idle" | "exited";
    exitCode: number | null;
    named: boolean;
    cols: number;
    rows: number;
    createdAt: number;
    lastActiveAt: number;
    runId?: string;
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- provider.unavailable
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "agentId": "agt_a1b2c3",
    "cols": 20,
    "computerId": "cmt_a1b2c3",
    "cwd": "example",
    "deviceId": "dev_a1b2c3",
    "host": "agent_computer",
    "idempotencyKey": "idem_1",
    "name": "example",
    "rows": 5
  },
  "output": {
    "terminal": {
      "agentId": "agt_a1b2c3",
      "cols": 1,
      "computerId": "cmt_a1b2c3",
      "createdAt": 1760000000000,
      "cwd": "example",
      "deviceId": "dev_a1b2c3",
      "exitCode": 1,
      "host": "agent_computer",
      "hostTitle": "Intake's computer",
      "lastActiveAt": 1760000000000,
      "name": "build",
      "named": true,
      "rows": 1,
      "runId": "run_a1b2c3",
      "state": "running",
      "terminalId": "trm_a1b2c3"
    }
  }
}
```
