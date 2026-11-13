# state.arrive

Host only: a new entry reached a thing; raise its head and every audience member's unread, in one transaction. Idempotent on position

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
| HTTP | POST /v1/state/arrive |
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
  pos: number;
  by: string | null;
  at: number;
  mentions?: Array<string>;
};
```

## Output

```ts
type Out = {
  applied: boolean;
  people: number;
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
    "at": 1760000000000,
    "by": "example",
    "mentions": [
      "example"
    ],
    "pos": 1,
    "thing": {
      "id": "cnv_a1b2c3",
      "type": "conversation"
    }
  },
  "output": {
    "applied": true,
    "people": 1
  }
}
```
