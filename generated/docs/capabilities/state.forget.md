# state.forget

Host only: a thing was deleted; every row and count of it goes

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
| HTTP | POST /v1/state/forget |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  thing: {
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

## Example

```json
{
  "name": "example",
  "input": {
    "thing": {
      "id": "cnv_a1b2c3",
      "type": "conversation"
    }
  },
  "output": {
    "ok": true
  }
}
```
