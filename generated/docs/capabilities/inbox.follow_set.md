# inbox.follow_set

Follow a contact or set Alert me on replies (the follow itself is stored with stars and follows)

| | |
|---|---|
| Module | inbox |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | record (/contactId) |
| Gate | none |
| Idempotency | natural |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/inbox/follow_set |
| MCP tool | inbox_follow_set (inbox) |
| CLI | none |
| Emits | conversation.follow_changed |

## Input

```ts
type In = {
  contactId: string;
  follow: boolean;
  alertOnReplies?: boolean;
};
```

## Output

```ts
type Out = {
  following: boolean;
  alertOnReplies: boolean;
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
    "alertOnReplies": true,
    "contactId": "rec_a1b2c3",
    "follow": true
  },
  "output": {
    "alertOnReplies": true,
    "following": true
  }
}
```
