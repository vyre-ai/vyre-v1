# agents.snapshot.take

Take the file snapshot a run uses; changes to the files apply between runs

| | |
|---|---|
| Module | agents |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | low |
| Resource | agent (/agentId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/agents/snapshot/take |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  agentId: string;
  runId?: string;
};
```

## Output

```ts
type Out = {
  snapshotId: string;
  version: number;
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
    "runId": "run_a1b2c3"
  },
  "output": {
    "snapshotId": "snp_a1b2c3",
    "version": 1
  }
}
```
