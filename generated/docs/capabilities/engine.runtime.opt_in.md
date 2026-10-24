# engine.runtime.opt_in

Let the Space continue my chats when my computer is off, by wrapping my runtime key for the Space; revocable

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/engine/runtime/opt_in |
| MCP tool | engine_runtime_opt_in (meta) |
| CLI | none |
| Emits | engine.runtime_opt_in_changed |

## Input

```ts
type In = {
  enabled: boolean;
  wrappedRuntimeKey?: string;
};
```

## Output

```ts
type Out = {
  enabled: boolean;
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
    "enabled": true,
    "wrappedRuntimeKey": "example"
  },
  "output": {
    "enabled": true
  }
}
```
