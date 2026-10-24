# runbooks.runs.get

One run with the output of each block (kept as run logs)

| | |
|---|---|
| Module | runbooks |
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
| HTTP | POST /v1/runbooks/runs/get |
| MCP tool | runbooks_runs_get (terminal) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  runId: string;
  blockId?: string;
  after?: number;
};
```

## Output

```ts
type Out = {
  run: {
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
  };
  output: Array<{
      blockId: string;
      seq: number;
      stream: "stdout" | "stderr";
      text: string;
    }>;
  next?: number;
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
    "after": 1,
    "blockId": "b2_9fc1",
    "runId": "run_a1b2c3"
  },
  "output": {
    "next": 1,
    "output": [
      {
        "blockId": "b2_9fc1",
        "seq": 1,
        "stream": "stdout",
        "text": "example"
      }
    ],
    "run": {
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
  }
}
```
