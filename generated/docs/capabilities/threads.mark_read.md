# threads.mark_read

Mark a thread read up to a sequence number

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
| HTTP | POST /v1/threads/mark_read |
| MCP tool | threads_mark_read (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
  upto?: number;
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
    "threadId": "thr_a1b2c3",
    "upto": 1
  },
  "output": {
    "unread": 1
  }
}
```
