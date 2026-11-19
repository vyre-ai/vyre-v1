# gate.allow.remove

Take an Always allow rule or an automation's permission back. It stops at the next act

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
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/gate/allow/remove |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  id: string;
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
- permission.not_found
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "id": "example"
  },
  "output": {
    "ok": true
  }
}
```
