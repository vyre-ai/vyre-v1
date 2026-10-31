# threads.delete

Delete a chat only I am in (me and agents): hidden everywhere, running turns stop first, undone with threads.restore until the retention purge removes it. A chat with other people is left, not deleted

| | |
|---|---|
| Module | chat |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | thread (/threadId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/threads/delete |
| MCP tool | none |
| CLI | none |
| Emits | thread.deleted |

## Input

```ts
type In = {
  threadId: string;
};
```

## Output

```ts
type Out = {
  deleted: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "deleted": true
  }
}
```
