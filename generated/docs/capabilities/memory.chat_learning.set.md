# memory.chat_learning.set

Don't remember this chat: anyone in it turns learning off; who turned it off, or who started the chat, turns it back on

| | |
|---|---|
| Module | memory |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/memory/chat_learning/set |
| MCP tool | none |
| CLI | none |
| Emits | memory.chat_learning_changed |

## Input

```ts
type In = {
  threadId: string;
  remember: boolean;
};
```

## Output

```ts
type Out = {
  threadId: string;
  remember: boolean;
  by?: string;
  at?: number;
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
    "remember": true,
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "at": 1760000000000,
    "by": "example",
    "remember": true,
    "threadId": "thr_a1b2c3"
  }
}
```
