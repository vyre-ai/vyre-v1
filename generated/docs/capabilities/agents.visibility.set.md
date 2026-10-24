# agents.visibility.set

Admin toggle "All in the Space" for agent lists (logged)

| | |
|---|---|
| Module | agents |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | access.manage |
| Grant level | edit |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/agents/visibility/set |
| MCP tool | agents_visibility_set (agents) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  all: boolean;
};
```

## Output

```ts
type Out = {
  all: boolean;
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
    "all": true
  },
  "output": {
    "all": true
  }
}
```
