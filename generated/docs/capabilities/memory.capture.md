# memory.capture

Learn from a chat: after each turn on the asker's own account and cheapest model inside their daily quota, else by rules; at chat end or when quiet, by rules over what no turn pass read

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
| HTTP | POST /v1/memory/capture |
| MCP tool | none |
| CLI | none |
| Emits | memory.captured, memory.fact_proposed, memory.fact_accepted, memory.learned |

## Input

```ts
type In = {
  threadId: string;
  reason: "closed" | "idle" | "turn";
  turnId?: string;
  agentId?: string;
  account?: {
    ref: string;
    driver: string;
    kind?: string;
    payer?: string;
    spaceKey?: boolean;
  };
};
```

## Output

```ts
type Out = {
  proposed: number;
  merged: number;
  updated?: number;
  closed?: number;
  via?: "model" | "rules" | "none";
  skipped?: "forgotten" | "off" | "nothing_new";
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.provider_label
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "account": {
      "driver": "example",
      "kind": "example",
      "payer": "example",
      "ref": "example",
      "spaceKey": true
    },
    "agentId": "agt_a1b2c3",
    "reason": "closed",
    "threadId": "thr_a1b2c3",
    "turnId": "example"
  },
  "output": {
    "closed": 1,
    "merged": 1,
    "proposed": 1,
    "skipped": "forgotten",
    "updated": 1,
    "via": "model"
  }
}
```
