# hooks.ask_admin

Ask the Space admins about a hook that stopped something: one Inbox line for each admin, and a quiet line in the chat saying you asked

| | |
|---|---|
| Module | hooks |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | member |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | none |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/hooks/ask_admin |
| MCP tool | none |
| CLI | none |
| Emits | hook.admin_asked |

## Input

```ts
type In = {
  id: string;
  threadId: string;
  note?: string;
};
```

## Output

```ts
type Out = {
  asked: boolean;
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
    "id": "example",
    "note": "example",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "asked": true
  }
}
```
