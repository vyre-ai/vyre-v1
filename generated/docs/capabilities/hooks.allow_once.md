# hooks.allow_once

Let a hook that stopped something go by, once, in this chat: the next time it would stop the same kind of call it lets it through. A person presses it, never an agent; a Space hook only an admin may let through. The pass ends after one use or ten minutes

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
| HTTP | POST /v1/hooks/allow_once |
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
  allowed: boolean;
  expiresAt: number;
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
    "allowed": true,
    "expiresAt": 1760000000000
  }
}
```
