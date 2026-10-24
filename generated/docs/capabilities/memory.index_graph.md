# memory.index_graph

Graph consumer: update graph nodes and edges for a changed note, record or chat (notes, links, relations, came-from)

| | |
|---|---|
| Module | memory |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/memory/index_graph |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  entity: string;
  id: string;
  seq: number;
};
```

## Output

```ts
type Out = {
  nodes: number;
  edges: number;
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
    "entity": "example",
    "id": "example",
    "seq": 1
  },
  "output": {
    "edges": 1,
    "nodes": 1
  }
}
```
