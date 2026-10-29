# memory.graph_everything

The admin "everything" graph view across all agents; every open is logged

| | |
|---|---|
| Module | memory |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | memory.admin |
| Grant level | manage |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/memory/graph_everything |
| MCP tool | memory_graph_everything (memory) |
| CLI | none |
| Emits | memory.everything_viewed |

## Input

```ts
type In = {
  asOf?: number;
};
```

## Output

```ts
type Out = {
  nodes: Array<{
      nodeId: string;
      kind: "note" | "person" | "client" | "project" | "site" | "decision" | "record" | "chat" | "agent" | "topic";
      title: string;
      layer?: "person" | "agent" | "project" | "space";
      cluster?: string;
      x?: number;
      y?: number;
      link?: string;
    }>;
  edges: Array<{
      from: string;
      to: string;
      kind: "link" | "relation" | "came_from" | "mention";
      label?: string;
      evidence?: string;
      at?: number;
    }>;
  clusters: Array<{
      name: string;
      hub: string;
      size: number;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "asOf": 1760000000000
  },
  "output": {
    "clusters": [
      {
        "hub": "example",
        "name": "example",
        "size": 1
      }
    ],
    "edges": [
      {
        "at": 1760000000000,
        "evidence": "example",
        "from": "example",
        "kind": "link",
        "label": "example",
        "to": "example"
      }
    ],
    "nodes": [
      {
        "cluster": "example",
        "kind": "note",
        "layer": "person",
        "link": "example",
        "nodeId": "example",
        "title": "example",
        "x": 1,
        "y": 1
      }
    ]
  }
}
```
