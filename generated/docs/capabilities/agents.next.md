# agents.next

Take your next job: a mention or a task. It names the chat to work in; what you do afterwards shows there. Nothing waiting answers job null. Only an outside agent has a queue

| | |
|---|---|
| Module | agents |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | member |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | none |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/agents/next |
| MCP tool | agents_next (agents) |
| CLI | none |
| Emits | agent.job_taken |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  job: ({
    jobId: string;
    kind: "mention" | "task" | "answer";
    threadId?: string;
    taskId?: string;
    messageId?: string;
    from: string;
    title: string;
    text: string;
    queuedAt: number;
  }) | null;
  waiting: number;
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
  "input": {},
  "output": {
    "job": {
      "from": "example",
      "jobId": "ojb_a1b2c3",
      "kind": "mention",
      "messageId": "msg_a1b2c3",
      "queuedAt": 1760000000000,
      "taskId": "tsk_a1b2c3",
      "text": "example",
      "threadId": "thr_a1b2c3",
      "title": "example"
    },
    "waiting": 1
  }
}
```
