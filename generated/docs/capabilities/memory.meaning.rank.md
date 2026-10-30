# memory.meaning.rank

Rank texts the caller already holds (chat messages, say) against a question by meaning; nothing is stored, so private text is safe; a score is 0 when unrelated and 0.5 to 1 when related, and the list is empty when the model is not ready

| | |
|---|---|
| Module | memory |
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
| HTTP | POST /v1/memory/meaning/rank |
| MCP tool | memory_meaning_rank (memory) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  query: string;
  candidates: Array<{
      id: string;
      text: string;
    }>;
};
```

## Output

```ts
type Out = {
  scores: Array<{
      id: string;
      score: number;
    }>;
  meaning: {
    state: "on" | "loading" | "not_set_up" | "degraded" | "off";
    model?: string;
    hint?: string;
  };
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
    "candidates": [
      {
        "id": "example",
        "text": "example"
      }
    ],
    "query": "example"
  },
  "output": {
    "meaning": {
      "hint": "example",
      "model": "example",
      "state": "on"
    },
    "scores": [
      {
        "id": "example",
        "score": 1
      }
    ]
  }
}
```
