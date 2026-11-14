# state.read

Mark a thing read up to a position, mark it unread, or mark it unread from a position. Give exactly one of upto, unread, fromPos

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
| HTTP | POST /v1/state/read |
| MCP tool | state_read (meta, deferred) |
| CLI | none |
| Emits | state.changed |

## Input

```ts
type In = {
  thing: {
    type: string;
    id: string;
  };
  upto?: number;
  unread?: true;
  fromPos?: number;
};
```

## Output

```ts
type Out = {
  unread: number;
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
    "fromPos": 1,
    "thing": {
      "id": "cnv_a1b2c3",
      "type": "conversation"
    },
    "unread": true,
    "upto": 1
  },
  "output": {
    "unread": 1
  }
}
```
