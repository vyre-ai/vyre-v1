# state.read_scope

Mark everything in one badge read, or only what arrived before a time

| | |
|---|---|
| Module | state |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | member |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/state/read_scope |
| MCP tool | state_read_scope (meta, deferred) |
| CLI | none |
| Emits | state.scope_read |

## Input

```ts
type In = {
  scope: string;
  before?: number;
};
```

## Output

```ts
type Out = {
  marked: number;
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
    "before": 1760000000000,
    "scope": "mailbox:mbx_a1b2c3"
  },
  "output": {
    "marked": 1
  }
}
```
