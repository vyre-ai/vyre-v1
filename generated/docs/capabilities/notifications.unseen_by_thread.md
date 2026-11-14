# notifications.unseen_by_thread

My unseen mentions per chat or channel, for the sidebar's mention badge; only my own, newest first, at most 500 threads

| | |
|---|---|
| Module | notifications |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | member |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/notifications/unseen_by_thread |
| MCP tool | notifications_unseen_by_thread (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadIds?: Array<string>;
};
```

## Output

```ts
type Out = {
  counts: Array<{
      threadId: string;
      mentions: number;
    }>;
  capped: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "threadIds": [
      "thr_a1b2c3"
    ]
  },
  "output": {
    "capped": true,
    "counts": [
      {
        "mentions": 1,
        "threadId": "thr_a1b2c3"
      }
    ]
  }
}
```
