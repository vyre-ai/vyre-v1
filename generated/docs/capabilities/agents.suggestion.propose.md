# agents.suggestion.propose

Propose a change to AGENT.md as a diff; people without Edit see Suggest to <owner>; personal preferences go to private memory instead

| | |
|---|---|
| Module | agents |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | agent (create under /agentId) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/agents/suggestion/propose |
| MCP tool | agents_suggestion_propose (agents) |
| CLI | none |
| Emits | agent.suggestion_proposed |

## Input

```ts
type In = {
  agentId: string;
  file?: string;
  diff: string;
  reason?: string;
  idempotencyKey: string;
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
    "agentId": "agt_a1b2c3",
    "diff": "example",
    "file": "example",
    "idempotencyKey": "idem_1",
    "reason": "example"
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
