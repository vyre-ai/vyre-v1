# runbooks.runs.list

History of runs of a runbook: who, where, when, exit and duration

| | |
|---|---|
| Module | runbooks |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | file (/fileId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/runbooks/runs/list |
| MCP tool | runbooks_runs_list (terminal) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  fileId: string;
  state?: "queued" | "running" | "succeeded" | "failed" | "stopped";
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  runs: Array<{
      runId: string;
      fileId: string;
      versionId: string;
      by: string;
      target: {
        kind: "server" | "computer";
        computerId?: string;
      };
      at: number;
      durationMs?: number;
      state: "queued" | "running" | "succeeded" | "failed" | "stopped";
      exit?: number;
      all: boolean;
      blocks: Array<{
          blockId: string;
          exit?: number;
          ms?: number;
          state: "queued" | "running" | "succeeded" | "failed" | "stopped";
        }>;
    }>;
  next?: string;
  total?: number;
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
    "cursor": "example",
    "fileId": "fil_a1b2c3",
    "limit": 1,
    "state": "queued"
  },
  "output": {
    "next": "example",
    "runs": [
      {
        "all": true,
        "at": 1760000000000,
        "blocks": [
          {
            "blockId": "b2_9fc1",
            "exit": 1,
            "ms": 1,
            "state": "queued"
          }
        ],
        "by": "example",
        "durationMs": 1,
        "exit": 1,
        "fileId": "fil_a1b2c3",
        "runId": "run_a1b2c3",
        "state": "queued",
        "target": {
          "computerId": "cmt_a1b2c3",
          "kind": "server"
        },
        "versionId": "ver_a1b2c3"
      }
    ],
    "total": 1
  }
}
```
