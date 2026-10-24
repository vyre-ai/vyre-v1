# terminal.list

List terminal sessions you can see, including named leftover scripts

| | |
|---|---|
| Module | terminal |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/terminal/list |
| MCP tool | terminal_list (terminal) |
| CLI | vyre terminal list |
| Emits | none |

## Input

```ts
type In = {
  section?: "personal" | "shared" | "space";
  folderId?: string;
  host?: "agent_computer" | "space_server" | "device";
  state?: Array<"running" | "idle" | "exited">;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  terminals: Array<{
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
    }>;
  next?: string;
  total?: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "cursor": "example",
    "folderId": "fld_a1b2c3",
    "host": "agent_computer",
    "limit": 1,
    "section": "personal",
    "state": [
      "running"
    ]
  },
  "output": {
    "next": "example",
    "terminals": [
      {
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
    ],
    "total": 1
  }
}
```
