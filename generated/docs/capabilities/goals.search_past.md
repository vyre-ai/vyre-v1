# goals.search_past

Past goals in this Space with their outcome and retrospective, to learn what worked before planning

| | |
|---|---|
| Module | goals |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | member |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/goals/search_past |
| MCP tool | goals_search_past (tasks) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  query?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  goals: Array<{
      goalId: string;
      title: string;
      line: string;
      ended?: "done" | "missed" | "stopped";
      value?: number;
      target?: number;
      endedAt?: number;
      retro?: {
        summary: string;
        worked: Array<string>;
        didNot: Array<string>;
        playbook?: string;
      };
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
    "limit": 1,
    "query": "example"
  },
  "output": {
    "goals": [
      {
        "ended": "done",
        "endedAt": 1760000000000,
        "goalId": "gol_a1b2c3",
        "line": "example",
        "retro": {
          "didNot": [
            "example"
          ],
          "playbook": "example",
          "summary": "example",
          "worked": [
            "example"
          ]
        },
        "target": 1,
        "title": "example",
        "value": 1
      }
    ]
  }
}
```
