# agents.suggestion.dismiss

Dismiss a suggestion

| | |
|---|---|
| Module | agents |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/agents/suggestion/dismiss |
| MCP tool | agents_suggestion_dismiss (agents) |
| CLI | none |
| Emits | agent.suggestion_resolved |

## Input

```ts
type In = {
  suggestionId: string;
};
```

## Output

```ts
type Out = {
  suggestion: {
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
  };
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
    "suggestionId": "sug_a1b2c3"
  },
  "output": {
    "suggestion": {
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
  }
}
```
