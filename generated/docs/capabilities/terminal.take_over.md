# terminal.take_over

Take the keyboard of a terminal: the agent's commands and everyone else's keys wait until you hand it back. Only the owner of the terminal or an admin can take it from another person

| | |
|---|---|
| Module | terminal |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | terminal (/terminalId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/terminal/take_over |
| MCP tool | none |
| CLI | none |
| Emits | terminal.taken |

## Input

```ts
type In = {
  terminalId: string;
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
    by?: {
      kind: "agent" | "helper" | "person";
      name?: string;
    };
    heldBy?: string;
    ownerId?: string;
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "terminalId": "trm_a1b2c3"
  },
  "output": {
    "terminal": {
      "agentId": "agt_a1b2c3",
      "by": {
        "kind": "agent",
        "name": "Ember"
      },
      "cols": 1,
      "computerId": "cmt_a1b2c3",
      "createdAt": 1760000000000,
      "cwd": "example",
      "deviceId": "dev_a1b2c3",
      "exitCode": 1,
      "heldBy": "usr_a1b2c3",
      "host": "agent_computer",
      "hostTitle": "Intake's computer",
      "lastActiveAt": 1760000000000,
      "name": "build",
      "named": true,
      "ownerId": "usr_a1b2c3",
      "rows": 1,
      "runId": "run_a1b2c3",
      "state": "running",
      "terminalId": "trm_a1b2c3"
    }
  }
}
```
