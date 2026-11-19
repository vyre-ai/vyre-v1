# runs.message.seen

The server marks delivered messages as read by their receiver

| | |
|---|---|
| Module | runs |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/runs/message/seen |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  messageIds: Array<string>;
};
```

## Output

```ts
type Out = {
  marked: number;
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
    "messageIds": [
      "example"
    ]
  },
  "output": {
    "marked": 1
  }
}
```
