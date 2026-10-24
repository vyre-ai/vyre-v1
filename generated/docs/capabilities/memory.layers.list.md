# memory.layers.list

Layers the caller may read for an agent (personal layers are private to their owner)

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
| HTTP | POST /v1/memory/layers/list |
| MCP tool | memory_layers_list (memory) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  agentId?: string;
  projectId?: string;
};
```

## Output

```ts
type Out = {
  layers: Array<{
      layer: "person" | "agent" | "project" | "space";
      title: string;
      readable: boolean;
      writable: boolean;
      private: boolean;
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
    "projectId": "prj_a1b2c3"
  },
  "output": {
    "layers": [
      {
        "layer": "person",
        "private": true,
        "readable": true,
        "title": "example",
        "writable": true
      }
    ]
  }
}
```
