# chat.pace_of

How a teammate answers, for their profile: usual reply time over the last 30 days, and for one chat how they hear about it. Reads only chats you are in with them

| | |
|---|---|
| Module | chat |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/chat/pace_of |
| MCP tool | chat_pace_of (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  personId: string;
  threadId?: string;
};
```

## Output

```ts
type Out = {
  replies: "minutes" | "hour" | "day" | "slow" | "unknown";
  samples: number;
  notifies?: "all" | "mentions" | "off";
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
    "personId": "usr_a1b2c3",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "notifies": "all",
    "replies": "minutes",
    "samples": 1
  }
}
```
