# agents.erased

The agents deleted for good, by the name they had, for the places that still show what they said (a chat or channel shows the name with a quiet deleted mark). Never a person's Assistant

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
| HTTP | POST /v1/agents/erased |
| MCP tool | agents_erased (agents) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  agents: Array<{
      agentId: string;
      name: string;
      erasedAt: number;
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
  "input": {},
  "output": {
    "agents": [
      {
        "agentId": "agt_a1b2c3",
        "erasedAt": 1760000000000,
        "name": "example"
      }
    ]
  }
}
```
