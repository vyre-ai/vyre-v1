# terminal.read

Read the scrollback of a session (secrets already scrubbed)

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
| HTTP | POST /v1/terminal/read |
| MCP tool | terminal_read (terminal) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  terminalId: string;
  lines?: number;
  since?: number;
};
```

## Output

```ts
type Out = {
  text: string;
  next: number;
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
    "lines": 1,
    "since": 1,
    "terminalId": "trm_a1b2c3"
  },
  "output": {
    "next": 1,
    "text": "example"
  }
}
```
