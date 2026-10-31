# terminal.request

Ask the person to run a command themselves (sudo, a login, an interactive install): the chat shows the command, why and its risk, and the person runs it in their terminal, copies it or declines; what it printed comes back to you

| | |
|---|---|
| Module | terminal |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | thread (/threadId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/terminal/request |
| MCP tool | terminal_request (terminal) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
  command: string;
  why: string;
  host?: "agent_computer" | "space_server" | "device";
};
```

## Output

```ts
type Out = {
  blockId: string;
  messageId: string;
  risk: "read" | "change" | "danger";
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
    "command": "example",
    "host": "agent_computer",
    "threadId": "thr_a1b2c3",
    "why": "example"
  },
  "output": {
    "blockId": "blk_a1b2c3",
    "messageId": "msg_a1b2c3",
    "risk": "read"
  }
}
```
