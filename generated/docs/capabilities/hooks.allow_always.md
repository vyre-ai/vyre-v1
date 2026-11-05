# hooks.allow_always

Always allow: from now on this hook lets the same kind of act (the one its newest stop in this chat was about) go by, in its own scope, and keeps guarding the rest. A person presses it, where they may change the hook

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
| HTTP | POST /v1/hooks/allow_always |
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
  allowed: {
    id: string;
    what: string;
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found
- validation.precondition_failed

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
    "allowed": {
      "id": "example",
      "what": "example"
    }
  }
}
```
