# chat.crew_line

The crew only: after Merge lands a teammate's branch, leave one quiet line in the chat. The text is built from the merge record ("Merged crew/ember-1 into main · +2 -0"); no words are passed in, only the job, and only the person who merged it can ask. It wakes no agent

| | |
|---|---|
| Module | chat |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | thread (/threadId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/chat/crew_line |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
  jobId: string;
};
```

## Output

```ts
type Out = {
  messageId: string;
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
    "jobId": "crw_01a1b2",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "messageId": "msg_a1b2c3"
  }
}
```
