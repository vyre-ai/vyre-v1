# gate.expire

Apply the timeout of a hold: drop it or escalate to the delegate or role (called by the scheduler)

| | |
|---|---|
| Module | gate |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/gate/expire |
| MCP tool | none |
| CLI | none |
| Emits | gate.expired |

## Input

```ts
type In = {
  holdId: string;
};
```

## Output

```ts
type Out = {
  outcome: "dropped" | "escalated";
  escalatedTo?: string;
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
    "escalatedTo": "example",
    "outcome": "dropped"
  }
}
```
