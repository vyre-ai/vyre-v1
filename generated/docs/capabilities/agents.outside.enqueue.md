# agents.outside.enqueue

System: a mention or a task for an outside agent waits in its queue until it asks

| | |
|---|---|
| Module | agents |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | none |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/agents/outside/enqueue |
| MCP tool | none |
| CLI | none |
| Emits | agent.job_queued |

## Input

```ts
type In = {
  agentId: string;
  kind: "mention" | "task" | "answer";
  threadId?: string;
  taskId?: string;
  messageId?: string;
  asker: string;
  title?: string;
  text?: string;
};
```

## Output

```ts
type Out = {
  queued: boolean;
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
    "asker": "example",
    "kind": "mention",
    "messageId": "msg_a1b2c3",
    "taskId": "tsk_a1b2c3",
    "text": "example",
    "threadId": "thr_a1b2c3",
    "title": "example"
  },
  "output": {
    "queued": true
  }
}
```
