# terminal.ask_signin

Ask the person to finish a login in your terminal (gh auth login, a vendor CLI): one sign-in card in the chat; people who may take over see Open terminal and Done, others see who you wait for; your turn waits for Done

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
| HTTP | POST /v1/terminal/ask_signin |
| MCP tool | terminal_ask_signin (terminal) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
  terminalId: string;
  why: string;
};
```

## Output

```ts
type Out = {
  blockId: string;
  messageId: string;
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
    "terminalId": "trm_a1b2c3",
    "threadId": "thr_a1b2c3",
    "why": "example"
  },
  "output": {
    "blockId": "blk_a1b2c3",
    "messageId": "msg_a1b2c3"
  }
}
```
