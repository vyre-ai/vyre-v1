# hooks.allow_remove

Take an always-allow rule away: the hook guards that kind of act again

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
| HTTP | POST /v1/hooks/allow_remove |
| MCP tool | none |
| CLI | none |
| Emits | hook.changed |

## Input

```ts
type In = {
  id: string;
};
```

## Output

```ts
type Out = {
  removed: boolean;
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
    "id": "example"
  },
  "output": {
    "removed": true
  }
}
```
