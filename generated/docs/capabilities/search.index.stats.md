# search.index.stats

Index size, consumer lag and vector backlog

| | |
|---|---|
| Module | search |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | manage |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/search/index/stats |
| MCP tool | search_index_stats (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  documents: number;
  vectors: number;
  ftsLagSeq: number;
  vectorBacklog: number;
  lastRebuildAt?: number;
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
  "input": {},
  "output": {
    "documents": 1,
    "ftsLagSeq": 1,
    "lastRebuildAt": 1760000000000,
    "vectorBacklog": 1,
    "vectors": 1
  }
}
```
