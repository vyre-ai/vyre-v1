# gate.result.take

System: hand the engine the answer of an approved call for a chat turn parked on it, once, and clear it. Only the server may call it; a requester or approver never reads the answer here.

| | |
|---|---|
| Module | gate |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/gate/result/take |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  holdId: string;
};
```

## Output

```ts
type Out = {
  found: boolean;
  result?: unknown;
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
    "holdId": "hld_a1b2c3"
  },
  "output": {
    "found": true,
    "result": {}
  }
}
```
