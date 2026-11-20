# tasks.still_answer

Answer the card for one or several tasks: keep (not asked again for 90 days) or archive (put away, Put back undoes it)

| | |
|---|---|
| Module | tasks |
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
| HTTP | POST /v1/tasks/still_answer |
| MCP tool | none |
| CLI | none |
| Emits | task.archived |

## Input

```ts
type In = {
  taskIds: Array<string>;
  answer: "keep" | "archive" | "seen" | "done";
};
```

## Output

```ts
type Out = {
  kept: number;
  archived: number;
  done: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "answer": "keep",
    "taskIds": [
      "tsk_a1b2c3"
    ]
  },
  "output": {
    "archived": 1,
    "done": 1,
    "kept": 1
  }
}
```
