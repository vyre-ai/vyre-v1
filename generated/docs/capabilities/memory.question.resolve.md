# memory.question.resolve

Answer an upkeep question with one click: keep one of two facts (the other goes to Trash), keep both, confirm an old fact, or drop it

| | |
|---|---|
| Module | memory |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/memory/question/resolve |
| MCP tool | memory_question_resolve (memory) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  questionId: string;
  resolution: "keep_a" | "keep_b" | "keep_both" | "drop";
};
```

## Output

```ts
type Out = {
  ok: boolean;
  resolution: string;
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
    "questionId": "example",
    "resolution": "keep_a"
  },
  "output": {
    "ok": true,
    "resolution": "example"
  }
}
```
