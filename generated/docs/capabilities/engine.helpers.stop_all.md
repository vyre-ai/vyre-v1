# engine.helpers.stop_all

Stop every helper still working under a chat; what they did so far is kept

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | thread (/threadId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/engine/helpers/stop_all |
| MCP tool | engine_helpers_stop_all (chats) |
| CLI | none |
| Emits | turn.cancelled |

## Input

```ts
type In = {
  threadId: string;
};
```

## Output

```ts
type Out = {
  stopped: number;
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
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "stopped": 1
  }
}
```
