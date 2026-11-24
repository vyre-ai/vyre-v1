# terminal.log.read

Part of what one command printed, scrubbed: the last lines, the lines that contain words (with context), or a range of lines; never the whole output

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
| HTTP | POST /v1/terminal/log/read |
| MCP tool | terminal_log_read (terminal) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  terminalId: string;
  commandId: number;
  tail?: number;
  match?: Array<string>;
  context?: number;
  from?: number;
  to?: number;
};
```

## Output

```ts
type Out = {
  lines: Array<{
      n: number;
      text: string;
    }>;
  totalLines: number;
  bytes: number;
  cutBytes: number;
  exitCode: number | null;
  more: boolean;
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
    "commandId": 1,
    "context": 1,
    "from": 1,
    "match": [
      "example"
    ],
    "tail": 1,
    "terminalId": "trm_a1b2c3",
    "to": 1
  },
  "output": {
    "bytes": 1,
    "cutBytes": 1,
    "exitCode": 1,
    "lines": [
      {
        "n": 1,
        "text": "example"
      }
    ],
    "more": true,
    "totalLines": 1
  }
}
```
