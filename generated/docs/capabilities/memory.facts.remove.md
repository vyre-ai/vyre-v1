# memory.facts.remove

Remove facts from answers (closed off, kept in history), one at a time or all at once for a layer or agent

| | |
|---|---|
| Module | memory |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/memory/facts/remove |
| MCP tool | memory_facts_remove (memory) |
| CLI | none |
| Emits | memory.removed |

## Input

```ts
type In = {
  factIds?: Array<string>;
  scope?: {
    layer: "person" | "agent" | "project" | "space";
    agentId?: string;
    fromMe?: boolean;
  };
};
```

## Output

```ts
type Out = {
  removed: number;
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
    "factIds": [
      "fct_a1b2c3"
    ],
    "scope": {
      "agentId": "agt_a1b2c3",
      "fromMe": true,
      "layer": "person"
    }
  },
  "output": {
    "removed": 1
  }
}
```
