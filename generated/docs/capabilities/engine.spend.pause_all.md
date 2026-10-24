# engine.spend.pause_all

Pause all AI spend in the Space

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | ai.spend |
| Grant level | manage |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/engine/spend/pause_all |
| MCP tool | engine_spend_pause_all (meta) |
| CLI | none |
| Emits | spend.paused |

## Input

```ts
type In = {
  reason?: string;
};
```

## Output

```ts
type Out = {
  paused: boolean;
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
    "reason": "example"
  },
  "output": {
    "paused": true
  }
}
```
