# state.layout.set

Set one layout value, or clear it with null. Only registered keys, each with a small size limit; it is never a place for content

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
| HTTP | POST /v1/state/layout/set |
| MCP tool | state_layout_set (meta, deferred) |
| CLI | none |
| Emits | state.layout_changed |

## Input

```ts
type In = {
  key: string;
  value: unknown;
};
```

## Output

```ts
type Out = {
  value: {
    key: string;
    value: unknown;
    version: number;
    at: number;
  };
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
    "key": "chats.sidebar.folds",
    "value": {}
  },
  "output": {
    "value": {
      "at": 1760000000000,
      "key": "chats.sidebar.folds",
      "value": {},
      "version": 1
    }
  }
}
```
