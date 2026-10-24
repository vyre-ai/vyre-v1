# terminal.close

Close a session and kill its tmux session

| | |
|---|---|
| Module | terminal |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | terminal (/terminalId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/terminal/close |
| MCP tool | terminal_close (terminal) |
| CLI | none |
| Emits | terminal.closed |

## Input

```ts
type In = {
  terminalId: string;
};
```

## Output

```ts
type Out = {
  closed: boolean;
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
    "terminalId": "trm_a1b2c3"
  },
  "output": {
    "closed": true
  }
}
```
