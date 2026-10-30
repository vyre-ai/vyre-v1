# memory.maintain

Upkeep, nightly or on demand: merge duplicates into Trash, flag contradictions and old facts as questions, close expired facts, and with a memory key let a model do the rest; rewrite MAP.md for each agent

| | |
|---|---|
| Module | memory |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/memory/maintain |
| MCP tool | none |
| CLI | none |
| Emits | memory.map_rewritten, memory.upkeep_ran, memory.fact_corrected, memory.learned |

## Input

```ts
type In = {
  agentId?: string;
  rulesOnly?: boolean;
};
```

## Output

```ts
type Out = {
  merged: number;
  closed: number;
  maps: number;
  runId?: string;
  flagged?: number;
  stale?: number;
  created?: number;
  corrected?: number;
  deleted?: number;
  tidied?: number;
  modelUsed?: boolean;
  costMicros?: number;
  tokensIn?: number;
  tokensOut?: number;
  stopped?: "cap" | "no_key";
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
    "agentId": "agt_a1b2c3",
    "rulesOnly": true
  },
  "output": {
    "closed": 1,
    "corrected": 1,
    "costMicros": 1,
    "created": 1,
    "deleted": 1,
    "flagged": 1,
    "maps": 1,
    "merged": 1,
    "modelUsed": true,
    "runId": "example",
    "stale": 1,
    "stopped": "cap",
    "tidied": 1,
    "tokensIn": 1,
    "tokensOut": 1
  }
}
```
