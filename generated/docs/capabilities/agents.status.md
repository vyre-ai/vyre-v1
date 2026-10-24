# agents.status

Live status of an agent: Awake (idle 2 minutes), Working, Asleep or Paused with reason and who

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
| HTTP | POST /v1/agents/status |
| MCP tool | agents_status (agents) |
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
  status: "awake" | "working" | "asleep" | "paused";
  since: number;
  reason?: string;
  by?: string;
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
    "by": "example",
    "reason": "example",
    "since": 1760000000000,
    "status": "awake"
  }
}
```
