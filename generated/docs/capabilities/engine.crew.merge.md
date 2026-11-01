# engine.crew.merge

Land a teammate's branch in the project repository: it is merged into the base branch when the repository is on it and clean, else it waits there as crew/<branch>. A person presses Merge; an agent asking holds at the Gate

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | high |
| Resource | space |
| Gate | push_protected when actor.kind != 'person' |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/engine/crew/merge |
| MCP tool | crew_merge (chats) |
| CLI | none |
| Emits | crew.job_merged, crew.job_pushed |

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
  landed: boolean;
  ref: string;
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
    "landed": true,
    "note": "example",
    "ref": "example"
  }
}
```
