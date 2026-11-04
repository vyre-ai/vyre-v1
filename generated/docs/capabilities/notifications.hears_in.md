# notifications.hears_in

Whether a teammate has muted one chat or channel, for their profile: only that, never what else they mute; asked by someone who can open the chat

| | |
|---|---|
| Module | notifications |
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
| HTTP | POST /v1/notifications/hears_in |
| MCP tool | notifications_hears_in (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  personId: string;
  threadId: string;
};
```

## Output

```ts
type Out = {
  muted: boolean;
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
    "muted": true
  }
}
```
