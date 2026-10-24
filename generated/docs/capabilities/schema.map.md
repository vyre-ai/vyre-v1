# schema.map

The Schema map: record types as nodes and relations as edges, two hops from a type if given

| | |
|---|---|
| Module | schema |
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
| HTTP | POST /v1/schema/map |
| MCP tool | schema_map (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  type?: string;
  hops?: number;
};
```

## Output

```ts
type Out = {
  nodes: Array<{
      type: string;
      title: string;
      rowCount: number;
    }>;
  edges: Array<{
      from: string;
      to: string;
      field: string;
      inverse?: string;
    }>;
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
    "hops": 1,
    "type": "contact"
  },
  "output": {
    "edges": [
      {
        "field": "phone",
        "from": "contact",
        "inverse": "phone",
        "to": "contact"
      }
    ],
    "nodes": [
      {
        "rowCount": 1,
        "title": "example",
        "type": "contact"
      }
    ]
  }
}
```
