# access.agents_can_call.set

A person with Manage on an agent says whether other agents in the Space may hand work to it (On unless turned Off)

| | |
|---|---|
| Module | access |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/access/agents_can_call/set |
| MCP tool | none |
| CLI | none |
| Emits | access.changed |

## Input

```ts
type In = {
  agentId: string;
  on: boolean;
};
```

## Output

```ts
type Out = {
  on: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "agentId": "agt_a1b2c3",
    "on": true
  },
  "output": {
    "on": true
  }
}
```
