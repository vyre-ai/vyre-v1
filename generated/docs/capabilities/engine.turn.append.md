# engine.turn.append

Persist a coalesced chunk of a running turn (text, tool call, tool result, block)

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | none |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/engine/turn/append |
| MCP tool | none |
| CLI | none |
| Emits | turn.block |

## Input

```ts
type In = {
  turnId: string;
  kind: "text" | "thinking" | "tool_call" | "tool_result" | "block";
  data: unknown;
};
```

## Output

```ts
type Out = {
  idx: number;
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
    "data": {},
    "kind": "text",
    "turnId": "trn_a1b2c3"
  },
  "output": {
    "idx": 1
  }
}
```
