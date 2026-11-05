# ci.runs.get

One run

| | |
|---|---|
| Module | ci |
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
| HTTP | POST /v1/ci/runs/get |
| MCP tool | ci_runs_get (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  runId: string;
};
```

## Output

```ts
type Out = {
  run: {
    runId: string;
    jobId: number;
    workflowRunId: number;
    repo: string;
    jobName: string;
    projectId: string | null;
    state: "queued" | "starting" | "running" | "finished" | "failed" | "swept" | "refused";
    dropletId: string | null;
    size: string | null;
    queuedAt: number;
    startedAt: number | null;
    endedAt: number | null;
    conclusion: string | null;
    costUsd: number;
    note: string | null;
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
    "runId": "cir_a1b2c3"
  },
  "output": {
    "run": {
      "conclusion": "example",
      "costUsd": 1,
      "dropletId": "example",
      "endedAt": 1760000000000,
      "jobId": 1,
      "jobName": "example",
      "note": "example",
      "projectId": "prj_a1b2c3",
      "queuedAt": 1760000000000,
      "repo": "vyre-ai/website",
      "runId": "cir_a1b2c3",
      "size": "example",
      "startedAt": 1760000000000,
      "state": "queued",
      "workflowRunId": 1
    }
  }
}
```
