# state.layout.get

How I arranged my screens: my layout values (all, or the named keys). A small value for each registered key, mine alone

| | |
|---|---|
| Module | state |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | member |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/state/layout/get |
| MCP tool | state_layout_get (meta, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  keys?: Array<string>;
};
```

## Output

```ts
type Out = {
  values: Array<{
      key: string;
      value: unknown;
      version: number;
      at: number;
    }>;
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
    "keys": [
      "example"
    ]
  },
  "output": {
    "values": [
      {
        "at": 1760000000000,
        "key": "chats.sidebar.folds",
        "value": {},
        "version": 1
      }
    ]
  }
}
```
