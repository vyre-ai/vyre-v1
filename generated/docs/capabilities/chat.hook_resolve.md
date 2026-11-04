# chat.hook_resolve

Hooks module only: mark a stop line answered (allowed this time, always allowed, or denied), for everyone in the chat

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
| HTTP | POST /v1/chat/hook_resolve |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
  messageId: string;
  resolution: "allowed" | "always" | "denied";
  by: string;
  what?: string;
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
    "by": "example",
    "messageId": "msg_a1b2c3",
    "resolution": "allowed",
    "threadId": "thr_a1b2c3",
    "what": "example"
  },
  "output": {
    "ok": true
  }
}
```
