# threads.follow

Follow a thread (its replies reach me), mute it (I stay in it, its replies are quiet and do not count as new) or leave it

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
| HTTP | POST /v1/threads/follow |
| MCP tool | threads_follow (chats) |
| CLI | none |
| Emits | channel.member_added, channel.member_removed |

## Input

```ts
type In = {
  threadId: string;
  mode: "follow" | "mute" | "leave";
};
```

## Output

```ts
type Out = {
  mode: "follow" | "mute" | "none";
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
    "mode": "follow",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "mode": "follow"
  }
}
```
