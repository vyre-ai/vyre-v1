# records.relations_map

Relationship map of a record: linked records out to two hops, each edge named by its relation field, limited to what the caller may see

| | |
|---|---|
| Module | records |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | record (/recordId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/records/relations_map |
| MCP tool | records_relations_map (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  type: string;
  recordId: string;
  hops?: number;
};
```

## Output

```ts
type Out = {
  nodes: Array<{
      recordId: string;
      type: string;
      title: string;
      hop: number;
    }>;
  edges: Array<{
      from: string;
      to: string;
      field: string;
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
    "hops": 1,
    "recordId": "rec_a1b2c3",
    "type": "contact"
  },
  "output": {
    "edges": [
      {
        "field": "example",
        "from": "rec_a1b2c3",
        "to": "rec_a1b2c3"
      }
    ],
    "nodes": [
      {
        "hop": 1,
        "recordId": "rec_a1b2c3",
        "title": "example",
        "type": "contact"
      }
    ]
  }
}
```
