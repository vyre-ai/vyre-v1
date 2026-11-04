# hooks.policy.set

Space admins: allow or turn off hooks made by agents for the whole Space. Hooks agents already made stay but do not run while it is off

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
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/hooks/policy/set |
| MCP tool | none |
| CLI | none |
| Emits | hook.changed |

## Input

```ts
type In = {
  agentHooks: boolean;
};
```

## Output

```ts
type Out = {
  agentHooks: boolean;
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
    "agentHooks": true
  },
  "output": {
    "agentHooks": true
  }
}
```
