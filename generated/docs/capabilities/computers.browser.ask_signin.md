# computers.browser.ask_signin

Ask the person to sign in for you in your browser (password, code, CAPTCHA): one sign-in card in the chat; people who may take over see Open browser and Done, others see who you wait for; your turn waits for Done

| | |
|---|---|
| Module | computers |
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
| HTTP | POST /v1/computers/browser/ask_signin |
| MCP tool | browser_ask_signin (computer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
  why: string;
  site?: string;
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
- provider.unavailable
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "site": "example",
    "threadId": "thr_a1b2c3",
    "why": "example"
  },
  "output": {
    "blockId": "blk_a1b2c3",
    "messageId": "msg_a1b2c3"
  }
}
```
