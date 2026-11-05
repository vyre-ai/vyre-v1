# threads.mark_unread_from

Mark a thread unread from one message on: the read point goes back to just before that message, so it and everything after it count as new (it never moves the point forward)

| | |
|---|---|
| Module | chat |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | thread (/threadId) |
| Gate | none |
| Idempotency | natural |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/threads/mark_unread_from |
| MCP tool | threads_mark_unread_from (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
  seq: number;
};
```

## Output

```ts
type Out = {
  unread: number;
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
    "seq": 1,
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "unread": 1
  }
}
```
