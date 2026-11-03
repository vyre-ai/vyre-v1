# agents.people_summary

For each person whose agents you cannot see (their Assistant, the agents they keep private): how many, what they spent this month against their cap, and whether they are paused. Never names or content

| | |
|---|---|
| Module | agents |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | agents.manage |
| Grant level | manage |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/agents/people_summary |
| MCP tool | agents_people_summary (agents) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  people: Array<{
      personId: string;
      assistant: boolean;
      privateAgents: number;
      spendMonthMicros: number;
      capMicros?: number;
      paused: boolean;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {},
  "output": {
    "people": [
      {
        "assistant": true,
        "capMicros": 1,
        "paused": true,
        "personId": "usr_a1b2c3",
        "privateAgents": 1,
        "spendMonthMicros": 1
      }
    ]
  }
}
```
