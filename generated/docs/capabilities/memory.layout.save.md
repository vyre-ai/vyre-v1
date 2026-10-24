# memory.layout.save

Save node positions for a graph

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
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/memory/layout/save |
| MCP tool | memory_layout_save (memory) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  scope: "agent" | "space";
  agentId?: string;
  positions: Record<string, {
      x: number;
      y: number;
    }>;
};
```

## Output

```ts
type Out = {
  ok: boolean;
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
    "positions": {},
    "scope": "agent"
  },
  "output": {
    "ok": true
  }
}
```
