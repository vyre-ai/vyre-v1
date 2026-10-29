# engine.turn.undo

Undo a turn: restore the previous version of each record and file the turn changed, move what it created to Trash and bring back what it deleted; acts that cannot be undone are left and reported

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | thread (/threadId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/engine/turn/undo |
| MCP tool | engine_turn_undo (chats) |
| CLI | none |
| Emits | turn.undone |

## Input

```ts
type In = {
  threadId: string;
  turnId: string;
};
```

## Output

```ts
type Out = {
  undone: number;
  left: Array<string>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "threadId": "thr_a1b2c3",
    "turnId": "trn_a1b2c3"
  },
  "output": {
    "left": [
      "example"
    ],
    "undone": 1
  }
}
```
