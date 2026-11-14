# engine.turn.asked_by

System use only: who asked for the calling agent's running turn in this chat (answers only to a module's own nested call). askedBy is set only when a person's own message started the turn or joined it

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/engine/turn/asked_by |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  kind: "message" | "interrupt" | "wake" | "handoff" | "none";
  routine: boolean;
  askedBy?: {
    person: string;
    messageIds: Array<string>;
    at: number;
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {},
  "output": {
    "askedBy": {
      "at": 1760000000000,
      "messageIds": [
        "msg_a1b2c3"
      ],
      "person": "usr_a1b2c3"
    },
    "kind": "message",
    "routine": true
  }
}
```
