# sessions.continue

Start a separate live Vyre chat linked to an immutable imported conversation; it never writes back to the local provider store

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
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sessions/continue |
| MCP tool | sessions_continue (chats) |
| CLI | none |
| Emits | sessions.continued |

## Input

```ts
type In = {
  conversationId: string;
  agentId: string;
  first?: string;
};
```

## Output

```ts
type Out = {
  threadId: string;
  linkedFrom: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "agentId": "agt_a1b2c3",
    "conversationId": "isc_a1b2c3",
    "first": "example"
  },
  "output": {
    "linkedFrom": "isc_a1b2c3",
    "threadId": "thr_a1b2c3"
  }
}
```
