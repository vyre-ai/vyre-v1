# ci.job.intake

Host only: a job is waiting (or ended) on GitHub; start or stop its machine. Called for the workflow_job events, never by a person

| | |
|---|---|
| Module | ci |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/ci/job/intake |
| MCP tool | ci_job_intake (engineer) |
| CLI | none |
| Emits | ci.run.started, ci.run.failed, ci.run.finished, ci.job.refused, ci.paused |

## Input

```ts
type In = {
  action: "queued" | "completed";
  repo: string;
  jobId: number;
  runId: number;
  name?: string;
  labels: Array<string>;
  fork?: "no" | "yes" | "unknown";
  conclusion?: string;
};
```

## Output

```ts
type Out = {
  handled: "started" | "queued" | "refused" | "ignored" | "finished" | "failed";
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
    "action": "queued",
    "conclusion": "example",
    "fork": "no",
    "jobId": 1,
    "labels": [
      "example"
    ],
    "name": "example",
    "repo": "vyre-ai/website",
    "runId": 1
  },
  "output": {
    "handled": "started"
  }
}
```
