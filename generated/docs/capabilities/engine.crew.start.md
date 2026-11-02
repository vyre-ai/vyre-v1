# engine.crew.start

Start a teammate on a brief: it gets its own thread under this chat and its own copy of the project repository on its own branch, and works until it is done

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | thread (/threadId) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/engine/crew/start |
| MCP tool | crew_start (chats) |
| CLI | none |
| Emits | crew.job_started |

## Input

```ts
type In = {
  threadId: string;
  projectId: string;
  teammateId: string;
  title: string;
  brief: string;
  model?: string;
  provider?: string;
  effort?: "low" | "medium" | "high" | "max";
  taskId?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  job: {
    jobId: string;
    threadId: string;
    leadThreadId: string;
    projectId: string;
    agentId: string;
    name?: string;
    title: string;
    branch: string;
    base: string;
    state: "working" | "waiting" | "done" | "failed" | "stopped" | "merged";
    startedAt: number;
    endedAt?: number;
    result?: Record<string, unknown>;
  };
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
    "brief": "example",
    "effort": "low",
    "idempotencyKey": "idem_1",
    "model": "example",
    "projectId": "prj_a1b2c3",
    "provider": "example",
    "taskId": "tsk_a1b2c3",
    "teammateId": "agt_a1b2c3",
    "threadId": "thr_a1b2c3",
    "title": "example"
  },
  "output": {
    "job": {
      "agentId": "agt_a1b2c3",
      "base": "main",
      "branch": "crew/ember-1",
      "endedAt": 1760000000000,
      "jobId": "crw_01a1b2",
      "leadThreadId": "thr_a1b2c3",
      "name": "example",
      "projectId": "prj_a1b2c3",
      "result": {},
      "startedAt": 1760000000000,
      "state": "working",
      "threadId": "thr_a1b2c3",
      "title": "example"
    }
  }
}
```
