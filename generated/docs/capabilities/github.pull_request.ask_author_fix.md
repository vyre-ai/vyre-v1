# github.pull_request.ask_author_fix

Ask the author agent to fix a failing check: creates a task (at most 3 rounds per pull request)

| | |
|---|---|
| Module | github |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | records.edit |
| Grant level | edit |
| Risk | medium |
| Resource | record (/recordId) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/github/pull_request/ask_author_fix |
| MCP tool | github_pull_request_ask_author_fix (records) |
| CLI | none |
| Emits | github.fix_requested |

## Input

```ts
type In = {
  recordId: string;
  checkName?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  taskId: string;
  attempt: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "checkName": "example",
    "idempotencyKey": "idem_1",
    "recordId": "rec_a1b2c3"
  },
  "output": {
    "attempt": 1,
    "taskId": "tsk_a1b2c3"
  }
}
```
