# terminal.capture

The screen of a session as tmux draws it, with its colours (escape sequences), the cursor, how much history there is, and whether a program is reading a hidden prompt (secrets already scrubbed)

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
| HTTP | POST /v1/terminal/capture |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  terminalId: string;
  lines?: number;
};
```

## Output

```ts
type Out = {
  text: string;
  cols: number;
  rows: number;
  cursor: {
    x: number;
    y: number;
  } | null;
  history: number;
  hidden: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "lines": 1,
    "terminalId": "trm_a1b2c3"
  },
  "output": {
    "cols": 1,
    "cursor": {
      "x": 1,
      "y": 1
    },
    "hidden": true,
    "history": 1,
    "rows": 1,
    "text": "example"
  }
}
```
