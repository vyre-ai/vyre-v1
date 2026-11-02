# sessions.archive

Move an imported session to the owner Archived list, or back out of it with unarchive

| | |
|---|---|
| Module | import |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | chats.private |
| Grant level | edit |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sessions/archive |
| MCP tool | sessions_archive (chats) |
| CLI | none |
| Emits | sessions.archived |

## Input

```ts
type In = {
  conversationId: string;
  unarchive?: boolean;
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
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "conversationId": "isc_a1b2c3",
    "unarchive": true
  },
  "output": {
    "archived": true
  }
}
```
