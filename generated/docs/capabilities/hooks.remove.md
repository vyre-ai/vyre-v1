# hooks.remove

Remove a hook you made

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
| HTTP | POST /v1/hooks/remove |
| MCP tool | hooks_remove (agents) |
| CLI | none |
| Emits | hook.changed |

## Input

```ts
type In = {
  id: string;
  threadId?: string;
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
    "id": "example",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "removed": true
  }
}
```
