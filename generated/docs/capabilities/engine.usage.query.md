# engine.usage.query

Usage by day, person, agent or model; people see their own, managers their agents, admins all

| | |
|---|---|
| Module | engine |
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
| HTTP | POST /v1/engine/usage/query |
| MCP tool | engine_usage_query (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  by: "day" | "person" | "agent" | "model";
  from?: number;
  to?: number;
  personId?: string;
  agentId?: string;
};
```

## Output

```ts
type Out = {
  rows: Array<{
      key: string;
      title: string;
      totals: {
        turns: number;
        tokensIn: number;
        tokensOut: number;
        costMicros: number;
      };
    }>;
  totals: {
    turns: number;
    tokensIn: number;
    tokensOut: number;
    costMicros: number;
  };
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
    "by": "day",
    "from": 1760000000000,
    "personId": "usr_a1b2c3",
    "to": 1760000000000
  },
  "output": {
    "rows": [
      {
        "key": "example",
        "title": "example",
        "totals": {
          "costMicros": 1,
          "tokensIn": 1,
          "tokensOut": 1,
          "turns": 1
        }
      }
    ],
    "totals": {
      "costMicros": 1,
      "tokensIn": 1,
      "tokensOut": 1,
      "turns": 1
    }
  }
}
```
