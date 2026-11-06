# agents.share_class

How an agent is shared, for the modules that decide who may watch its work (its browser): private to its person (an Assistant or an outside agent), personal (shared with nobody), shared with named people, or with the whole Space. Only for an agent the caller can see

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
| HTTP | POST /v1/agents/share_class |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  agentId: string;
};
```

## Output

```ts
type Out = {
  class: "private" | "personal" | "shared" | "space";
  ownerId: string;
  people: Array<string>;
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
    "agentId": "agt_a1b2c3"
  },
  "output": {
    "class": "private",
    "ownerId": "usr_a1b2c3",
    "people": [
      "usr_a1b2c3"
    ]
  }
}
```
