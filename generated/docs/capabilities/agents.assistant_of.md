# agents.assistant_of

A person's own Assistant, for the server's modules that work for them; only the server and the person themself are answered

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
| HTTP | POST /v1/agents/assistant_of |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  personId: string;
};
```

## Output

```ts
type Out = {
  agentId?: string;
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
    "personId": "usr_a1b2c3"
  },
  "output": {
    "agentId": "agt_a1b2c3"
  }
}
```
