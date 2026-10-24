# agents.template.preview

Preview propagation before applying ("12 agents, 3 folders added, 2 suggestions")

| | |
|---|---|
| Module | agents |
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
| HTTP | POST /v1/agents/template/preview |
| MCP tool | agents_template_preview (agents) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  scope: "all" | "one";
  agentId?: string;
};
```

## Output

```ts
type Out = {
  agents: number;
  foldersAdded: number;
  filesAdded: number;
  suggestions: number;
  widening: number;
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
    "scope": "all"
  },
  "output": {
    "agents": 1,
    "filesAdded": 1,
    "foldersAdded": 1,
    "suggestions": 1,
    "widening": 1
  }
}
```
