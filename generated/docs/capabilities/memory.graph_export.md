# memory.graph_export

Export a graph as a file; personal layers are never included

| | |
|---|---|
| Module | memory |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/memory/graph_export |
| MCP tool | memory_graph_export (memory) |
| CLI | none |
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
  fileId: string;
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
    "fileId": "fil_a1b2c3"
  }
}
```
