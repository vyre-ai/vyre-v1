# runs.board.put

A node writes to the board of its tree: a fact or decision with what it stands on, or a question

| | |
|---|---|
| Module | runs |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | run (/runId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/runs/board/put |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  runId: string;
  kind: "fact" | "decision" | "question";
  text: string;
  topic?: string;
  evidence?: Array<string>;
};
```

## Output

```ts
type Out = {
  entry: {
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
  };
  conflict?: {
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
    "evidence": [
      "example"
    ],
    "kind": "fact",
    "runId": "run_a1b2c3",
    "text": "example",
    "topic": "example"
  },
  "output": {
    "conflict": {
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
    },
    "entry": {
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
  }
}
```
