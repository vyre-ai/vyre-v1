# runs.board.list

The board of a tree: what its nodes know together, newest last

| | |
|---|---|
| Module | runs |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | run (/runId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/runs/board/list |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  runId: string;
  all?: boolean;
};
```

## Output

```ts
type Out = {
  entries: Array<{
      id: string;
      rootRun: string;
      kind: "fact" | "decision" | "question";
      topic?: string;
      text: string;
      byRun: string;
      evidence: Array<string>;
      at: number;
      supersededBy?: string;
      answer?: {
        byRun: string;
        text: string;
        at: number;
      };
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
    "all": true,
    "runId": "run_a1b2c3"
  },
  "output": {
    "entries": [
      {
        "answer": {
          "at": 1760000000000,
          "byRun": "example",
          "text": "example"
        },
        "at": 1760000000000,
        "byRun": "run_a1b2c3",
        "evidence": [
          "example"
        ],
        "id": "example",
        "kind": "fact",
        "rootRun": "run_a1b2c3",
        "supersededBy": "example",
        "text": "example",
        "topic": "example"
      }
    ]
  }
}
```
