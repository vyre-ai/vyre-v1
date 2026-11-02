# sessions.delete

Remove an imported session from Vyre: its copied transcript is dropped and a later import of the same source session skips it. The original Claude Code or Codex files on the computer are never touched, and a chat continued from it stays and keeps working

| | |
|---|---|
| Module | import |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | chats.private |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/sessions/delete |
| MCP tool | none |
| CLI | none |
| Emits | sessions.deleted |

## Input

```ts
type In = {
  conversationId: string;
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
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "conversationId": "isc_a1b2c3"
  },
  "output": {
    "deleted": true
  }
}
```
