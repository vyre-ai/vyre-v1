# terminal.log.list

The commands of a terminal, newest first, and whether the output of each is still kept (a week after it ended)

| | |
|---|---|
| Module | terminal |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | terminal (/terminalId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/terminal/log/list |
| MCP tool | terminal_log_list (terminal) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  terminalId: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  commands: Array<{
      commandId: number;
      command: string;
      exitCode: number | null;
      startedAt: number;
      durationMs?: number;
      kept: boolean;
      bytes: number;
      cutBytes?: number;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "limit": 1,
    "terminalId": "trm_a1b2c3"
  },
  "output": {
    "commands": [
      {
        "bytes": 1,
        "command": "example",
        "commandId": 1,
        "cutBytes": 1,
        "durationMs": 1,
        "exitCode": 1,
        "kept": true,
        "startedAt": 1760000000000
      }
    ]
  }
}
```
