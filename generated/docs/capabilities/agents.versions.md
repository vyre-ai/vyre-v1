# agents.versions

List versions of an agent definition (AGENT.md, agent.toml) for rollback

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
| HTTP | POST /v1/agents/versions |
| MCP tool | agents_versions (agents) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  agentId: string;
  file?: "AGENT.md" | "agent.toml";
};
```

## Output

```ts
type Out = {
  versions: Array<{
      versionId: string;
      n: number;
      by: string;
      at: number;
      reason?: string;
      name?: string;
    }>;
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
    "agentId": "agt_a1b2c3",
    "file": "AGENT.md"
  },
  "output": {
    "versions": [
      {
        "at": 1760000000000,
        "by": "example",
        "n": 1,
        "name": "example",
        "reason": "example",
        "versionId": "ver_a1b2c3"
      }
    ]
  }
}
```
