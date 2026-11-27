# terminal.stream

Open a live stream of a session's screen over a WebSocket: changes as they happen, numbered, resumable. Send the ticket as the first message, not in the address. Typing stays terminal.keys

| | |
|---|---|
| Module | terminal |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | terminal (/terminalId) |
| Gate | none |
| Idempotency | none |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/terminal/stream |
| MCP tool | terminal_stream (terminal) |
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
  ws: string;
  ticket: string;
  expiresAt: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "terminalId": "trm_a1b2c3"
  },
  "output": {
    "expiresAt": 1760000000000,
    "ticket": "example",
    "ws": "example"
  }
}
```
