# gate.holds.revise

Change what a held message says before it is sent. The approval is bound to the new words and the card says it was edited

| | |
|---|---|
| Module | gate |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | task (/taskId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/gate/holds/revise |
| MCP tool | none |
| CLI | none |
| Emits | gate.revised |

## Input

```ts
type In = {
  holdId: string;
  taskId: string;
  body: string;
  title?: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
  edited: number;
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
    "body": "example",
    "holdId": "hld_a1b2c3",
    "taskId": "tsk_a1b2c3",
    "title": "example"
  },
  "output": {
    "edited": 1,
    "ok": true
  }
}
```
