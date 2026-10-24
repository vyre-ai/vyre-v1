# agents.suggestions.list

Open suggestions for an agent: AGENT.md diffs from the agent and template suggestions

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
| HTTP | POST /v1/agents/suggestions/list |
| MCP tool | agents_suggestions_list (agents) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  agentId?: string;
  kind?: "agent_md" | "template";
  state?: Array<"open" | "accepted" | "dismissed">;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  suggestions: Array<{
      suggestionId: string;
      agentId: string;
      kind: "agent_md" | "template";
      file: string;
      diff: string;
      reason?: string;
      widening: boolean;
      state: "open" | "accepted" | "dismissed";
      proposedBy: string;
      proposedAt: number;
      taskId?: string;
    }>;
  next?: string;
  total?: number;
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
    "cursor": "example",
    "kind": "agent_md",
    "limit": 1,
    "state": [
      "open"
    ]
  },
  "output": {
    "next": "example",
    "suggestions": [
      {
        "agentId": "agt_a1b2c3",
        "diff": "example",
        "file": "AGENT.md",
        "kind": "agent_md",
        "proposedAt": 1760000000000,
        "proposedBy": "example",
        "reason": "example",
        "state": "open",
        "suggestionId": "sug_a1b2c3",
        "taskId": "tsk_a1b2c3",
        "widening": true
      }
    ],
    "total": 1
  }
}
```
