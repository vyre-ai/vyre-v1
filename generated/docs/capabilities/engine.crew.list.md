# engine.crew.list

The crew of a chat: one row per teammate job, newest first, with what each is on and how it stands

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | thread (/threadId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/engine/crew/list |
| MCP tool | crew_list (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
};
```

## Output

```ts
type Out = {
  jobs: Array<{
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
    }>;
  waits: Array<{
      waitId: string;
      kind: "checks";
      label: string;
      state: "pending" | "passing" | "failing" | "none";
      done: number;
      total: number;
      startedAt: number;
    }>;
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
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "jobs": [
      {
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
    ],
    "waits": [
      {
        "done": 1,
        "kind": "checks",
        "label": "acme/site#12",
        "startedAt": 1760000000000,
        "state": "pending",
        "total": 1,
        "waitId": "example"
      }
    ]
  }
}
```
