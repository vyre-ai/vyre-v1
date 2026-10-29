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
  layers?: Array<"person" | "agent" | "project" | "space">;
  focus?: string;
  hops?: number;
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
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "agentId": "agt_a1b2c3",
    "asOf": 1760000000000,
    "focus": "example",
    "hops": 1,
    "kinds": [
      "example"
    ],
    "layers": [
      "person"
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
