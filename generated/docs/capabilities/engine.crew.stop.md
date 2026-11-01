# engine.crew.stop

Stop a teammate: its running turn ends and anything queued for it is dropped; its work stays on its branch

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/engine/crew/stop |
| MCP tool | crew_stop (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  jobId: string;
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
    state: "working" | "waiting" | "paused" | "lost" | "done" | "failed" | "stopped" | "merged";
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

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
    "jobId": "example"
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
