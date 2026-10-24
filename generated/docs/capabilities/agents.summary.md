# agents.summary

The agent page strip: chats this week, open tasks, runs today, spend against limit, memory facts, proposed facts, Working on, Linked

| | |
|---|---|
| Module | agents |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | agent (/agentId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/agents/summary |
| MCP tool | agents_summary (agents) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  agentId: string;
};
```

## Output

```ts
type Out = {
  chatsThisWeek: number;
  openTasks: number;
  runsToday: number;
  spendTodayMicros: number;
  spendLimitMicros?: number;
  memoryFacts: number;
  proposedFacts: number;
  workingOn: Array<{
      kind: string;
      id: string;
      title: string;
    }>;
  linked: Array<{
      kind: string;
      id: string;
      title: string;
    }>;
  watches: Array<string>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "agentId": "agt_a1b2c3"
  },
  "output": {
    "chatsThisWeek": 1,
    "linked": [
      {
        "id": "example",
        "kind": "example",
        "title": "example"
      }
    ],
    "memoryFacts": 1,
    "openTasks": 1,
    "proposedFacts": 1,
    "runsToday": 1,
    "spendLimitMicros": 1,
    "spendTodayMicros": 1,
    "watches": [
      "chn_a1b2c3"
    ],
    "workingOn": [
      {
        "id": "example",
        "kind": "example",
        "title": "example"
      }
    ]
  }
}
```
