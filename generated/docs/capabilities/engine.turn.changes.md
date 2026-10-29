# engine.turn.changes

What one agent turn changed on behalf of the asker: records and files it created or edited (each can go back) and acts that cannot be undone, such as a send

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | thread (/threadId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/engine/turn/changes |
| MCP tool | engine_turn_changes (chats) |
| CLI | none |
| Emits | none |

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
  changes: Array<{
      label: string;
      undoable: boolean;
    }>;
  undone: boolean;
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
    "threadId": "thr_a1b2c3",
    "turnId": "trn_a1b2c3"
  },
  "output": {
    "changes": [
      {
        "label": "example",
        "undoable": true
      }
    ],
    "undone": true
  }
}
```
