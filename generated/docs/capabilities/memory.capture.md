# memory.capture

Capture at chat end: a cheap-model pass proposes facts to the person layer; channel facts go to the project layer, Automation facts to proposed/

| | |
|---|---|
| Module | memory |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/memory/capture |
| MCP tool | none |
| CLI | none |
| Emits | memory.captured, memory.fact_proposed, memory.fact_accepted |

## Input

```ts
type In = {
  threadId: string;
  reason: "closed" | "idle";
};
```

## Output

```ts
type Out = {
  proposed: number;
  merged: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.provider_label
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "reason": "closed",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "merged": 1,
    "proposed": 1
  }
}
```
