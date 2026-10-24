# memory.graph

The memory graph for an agent or the Space, built per viewer through access checks; agent, project and Space layers only

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
| HTTP | POST /v1/memory/graph |
| MCP tool | memory_graph (memory) |
| CLI | vyre memory graph |
| Emits | none |

## Input

```ts
type In = {
  scope: "agent" | "space";
  agentId?: string;
  asOf?: number;
  kinds?: Array<string>;
};
```

## Output

```ts
type Out = {
  nodes: Array<{
      nodeId: string;
      kind: "note" | "person" | "client" | "project" | "site" | "decision" | "record" | "chat";
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
      kind: "link" | "relation" | "came_from";
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
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "agentId": "agt_a1b2c3",
    "asOf": 1760000000000,
    "kinds": [
      "example"
    ],
    "scope": "agent"
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
        "from": "example",
        "kind": "link",
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
