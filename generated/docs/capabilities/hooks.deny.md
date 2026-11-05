# hooks.deny

Deny: the stop stands. The stop line is marked for everyone in the chat and the agent is told on its next turn. A person presses it, where they may change the hook

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
| HTTP | POST /v1/hooks/deny |
| MCP tool | none |
| CLI | none |
| Emits | hook.changed |

## Input

```ts
type In = {
  id: string;
  threadId: string;
  messageId?: string;
};
```

## Output

```ts
type Out = {
  denied: boolean;
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
    "messageId": "msg_a1b2c3",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "denied": true
  }
}
```
