# threads.archive

Archive a chat for me: it leaves my list and waits in my Archived section; the others in a group chat still see it. New messages do not bring it back, an @mention of me does

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
| HTTP | POST /v1/threads/archive |
| MCP tool | threads_archive (chats) |
| CLI | none |
| Emits | thread.archived |

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
