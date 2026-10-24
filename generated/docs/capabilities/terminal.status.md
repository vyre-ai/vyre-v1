# terminal.status

Live status of terminals for Home (state and last line read from tmux)

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
| HTTP | POST /v1/terminal/status |
| MCP tool | terminal_status (terminal) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  terminalIds: Array<string>;
};
```

## Output

```ts
type Out = {
  rows: Array<{
      terminalId: string;
      state: "running" | "idle" | "exited";
      lastLine?: string;
      exitCode: number | null;
    }>;
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
    "terminalIds": [
      "trm_a1b2c3"
    ]
  },
  "output": {
    "rows": [
      {
        "exitCode": 1,
        "lastLine": "example",
        "state": "running",
        "terminalId": "trm_a1b2c3"
      }
    ]
  }
}
```
