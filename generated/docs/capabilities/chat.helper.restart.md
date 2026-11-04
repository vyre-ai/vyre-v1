# chat.helper.restart

Start a helper again on another model: the person it works for picks an account and a model, and it does its brief again from the start

| | |
|---|---|
| Module | chat |
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
| HTTP | POST /v1/chat/helper/restart |
| MCP tool | chat_helper_restart (chats) |
| CLI | none |
| Emits | helper.note, message.received, message.direct, message.mentioned, thread.replied, thread.unarchived |

## Input

```ts
type In = {
  threadId: string;
  helperId: string;
  model?: string;
  account?: string;
  provider?: string;
};
```

## Output

```ts
type Out = {
  messageId: string;
  model: string;
  account: string;
  fellBackFrom?: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.unavailable
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "account": "example",
    "helperId": "thr_a1b2c3",
    "model": "example",
    "provider": "example",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "account": "example",
    "fellBackFrom": "example",
    "messageId": "msg_a1b2c3",
    "model": "example"
  }
}
```
