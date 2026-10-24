# engine.subscription_share.set

Let the Space run work on my subscription (server runs for my chats, routines and personal automations); off kills my sandbox

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/engine/subscription_share/set |
| MCP tool | engine_subscription_share_set (meta) |
| CLI | none |
| Emits | engine.subscription_share_changed |

## Input

```ts
type In = {
  enabled: boolean;
};
```

## Output

```ts
type Out = {
  enabled: boolean;
  sandboxStopped: boolean;
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
    "enabled": true
  },
  "output": {
    "enabled": true,
    "sandboxStopped": true
  }
}
```
