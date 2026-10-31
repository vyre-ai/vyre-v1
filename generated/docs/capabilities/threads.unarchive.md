# threads.unarchive

Put an archived chat back in my list

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
| HTTP | POST /v1/threads/unarchive |
| MCP tool | threads_unarchive (chats) |
| CLI | none |
| Emits | thread.unarchived |

## Input

```ts
type In = {
  threadId: string;
};
```

## Output

```ts
type Out = {
  archived: boolean;
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
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "archived": true
  }
}
```
