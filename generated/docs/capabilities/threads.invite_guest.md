# threads.invite_guest

Invite someone by email as a guest of this channel chat only: no files folder, no records, no other chats. level view reads, reply also writes. Only the channel owner or a manager invites; a private chat becomes a channel first

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
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/threads/invite_guest |
| MCP tool | threads_invite_guest (chats) |
| CLI | none |
| Emits | member.invited |

## Input

```ts
type In = {
  threadId: string;
  email: string;
  level?: "view" | "reply";
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  inviteId: string;
  link: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.not_contained
- validation.bad_input
- validation.duplicate
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "email": "sam@example.com",
    "idempotencyKey": "idem_1",
    "level": "view",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "inviteId": "inv_a1b2c3",
    "link": "example"
  }
}
```
