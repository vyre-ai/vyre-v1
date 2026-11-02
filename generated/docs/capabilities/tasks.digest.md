# tasks.digest

What an agent should keep in mind: the task bound to this thread, its parent and siblings in a line each, then its own open tasks, the top five and a count. About 300 tokens; detail stays one tasks_get away

| | |
|---|---|
| Module | tasks |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/tasks/digest |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  agentId: string;
  threadId?: string;
};
```

## Output

```ts
type Out = {
  text: string;
  hash: string;
  boundTaskId?: string;
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
    "agentId": "agt_a1b2c3",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "boundTaskId": "tsk_a1b2c3",
    "hash": "example",
    "text": "example"
  }
}
```
