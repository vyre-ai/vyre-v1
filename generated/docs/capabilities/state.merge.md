# state.merge

Host only: one thing became part of another; merge each person's flags and recount

| | |
|---|---|
| Module | state |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | member |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/state/merge |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  from: {
    type: string;
    id: string;
  };
  to: {
    type: string;
    id: string;
  };
};
```

## Output

```ts
type Out = {
  ok: boolean;
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
    "from": {
      "id": "cnv_a1b2c3",
      "type": "conversation"
    },
    "to": {
      "id": "cnv_a1b2c3",
      "type": "conversation"
    }
  },
  "output": {
    "ok": true
  }
}
```
