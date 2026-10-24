# terminal.interrupt

Send Ctrl-C to a session

| | |
|---|---|
| Module | terminal |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | low |
| Resource | terminal (/terminalId) |
| Gate | none |
| Idempotency | none |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/terminal/interrupt |
| MCP tool | terminal_interrupt (terminal) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  terminalId: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
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
    "ok": true
  }
}
```
