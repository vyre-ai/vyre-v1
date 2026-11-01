# engine.crew.push

Push the project repository's base branch, with a teammate's merged work in it, to its remote. It is an outward act from the host and always holds at the Gate for a person's approval

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | high |
| Resource | space |
| Gate | push_protected |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/engine/crew/push |
| MCP tool | crew_push (chats) |
| CLI | none |
| Emits | crew.job_pushed |

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
    state: "working" | "waiting" | "done" | "failed" | "stopped" | "merged";
    startedAt: number;
    endedAt?: number;
    result?: Record<string, unknown>;
  };
  pushed: boolean;
  note?: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_approval
- permission.no_grant
- validation.bad_input
- validation.not_found
- validation.precondition_failed

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
    },
    "note": "example",
    "pushed": true
  }
}
```
