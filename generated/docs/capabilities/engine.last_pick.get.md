# engine.last_pick.get

The model the caller last picked in a chat (any agent): a new chat starts on it. Empty when they have not picked one yet

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/engine/last_pick/get |
| MCP tool | engine_last_pick_get (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  provider?: string;
  model?: string;
  effort?: "low" | "medium" | "high" | "max";
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
  "input": {},
  "output": {
    "effort": "low",
    "model": "example",
    "provider": "example"
  }
}
```
