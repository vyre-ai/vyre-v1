# gate.deny

Deny a hold: send back with a note for the asker thread, or drop the call

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
| HTTP | POST /v1/gate/deny |
| MCP tool | none |
| CLI | none |
| Emits | gate.denied |

## Input

```ts
type In = {
  holdId: string;
  taskId: string;
  mode: "send_back" | "drop";
  note?: string;
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
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "holdId": "hld_a1b2c3",
    "mode": "send_back",
    "note": "example",
    "taskId": "tsk_a1b2c3"
  },
  "output": {
    "ok": true
  }
}
```
