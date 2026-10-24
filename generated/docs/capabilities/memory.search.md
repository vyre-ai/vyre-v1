# memory.search

Search notes and current facts the asker may read; BM25, vectors and recency; snippets carry the source link

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
| HTTP | POST /v1/memory/search |
| MCP tool | memory_search (memory) |
| CLI | vyre memory search |
| Emits | none |

## Input

```ts
type In = {
  q: string;
  layers?: Array<"person" | "agent" | "project" | "space">;
  agentId?: string;
  projectId?: string;
  mode?: "keyword" | "semantic" | "hybrid";
  limit?: number;
};
```

## Output

```ts
type Out = {
  hits: Array<{
      kind: "note" | "fact";
      noteId?: string;
      factId?: string;
      title: string;
      text: string;
      path?: string;
      trueSince?: number;
      layer: "person" | "agent" | "project" | "space";
      sourceLink?: string;
      score: number;
    }>;
  tookMs: number;
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
    "agentId": "agt_a1b2c3",
    "layers": [
      "person"
    ],
    "limit": 1,
    "mode": "keyword",
    "projectId": "prj_a1b2c3",
    "q": "example"
  },
  "output": {
    "hits": [
      {
        "factId": "fct_a1b2c3",
        "kind": "note",
        "layer": "person",
        "noteId": "not_a1b2c3",
        "path": "example",
        "score": 1,
        "sourceLink": "example",
        "text": "example",
        "title": "example",
        "trueSince": 1760000000000
      }
    ],
    "tookMs": 1
  }
}
```
