# agents.config.may_save

May the caller save this agent.toml, which is an agent's settings? Files asks as the writer before it writes; a file that is no agent's agent.toml answers allowed

| | |
|---|---|
| Module | agents |
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
| HTTP | POST /v1/agents/config/may_save |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  fileId: string;
};
```

## Output

```ts
type Out = {
  agentId: string | null;
  allowed: boolean;
  reason?: "person_only" | "no_edit";
  message?: string;
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
    "fileId": "fil_a1b2c3"
  },
  "output": {
    "agentId": "agt_a1b2c3",
    "allowed": true,
    "message": "example",
    "reason": "person_only"
  }
}
```
