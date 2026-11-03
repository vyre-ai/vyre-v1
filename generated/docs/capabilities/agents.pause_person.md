# agents.pause_person

Pause every agent of one person, or let them run again. Audited, and the person is told. Answers how many changed, never which

| | |
|---|---|
| Module | agents |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | agents.manage |
| Grant level | manage |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/agents/pause_person |
| MCP tool | agents_pause_person (agents) |
| CLI | none |
| Emits | agent.paused, agent.resumed |

## Input

```ts
type In = {
  personId: string;
  paused: boolean;
};
```

## Output

```ts
type Out = {
  changed: number;
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
  "input": {
    "paused": true,
    "personId": "usr_a1b2c3"
  },
  "output": {
    "changed": 1
  }
}
```
