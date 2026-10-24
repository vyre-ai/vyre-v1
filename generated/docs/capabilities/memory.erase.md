# memory.erase

Erase completely: delete facts from history; open to the source person or an admin; the audit entry records who and when, never what

| | |
|---|---|
| Module | memory |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | manage |
| Risk | high |
| Resource | space |
| Gate | delete when actor.kind != 'person' |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/memory/erase |
| MCP tool | memory_erase (memory) |
| CLI | none |
| Emits | memory.erased |

## Input

```ts
type In = {
  factIds?: Array<string>;
  scope?: {
    layer: "person" | "agent" | "project" | "space";
    agentId?: string;
    sourceRef?: string;
    subject?: string;
  };
  reason?: string;
};
```

## Output

```ts
type Out = {
  erased: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.on_hold
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "factIds": [
      "fct_a1b2c3"
    ],
    "reason": "example",
    "scope": {
      "agentId": "agt_a1b2c3",
      "layer": "person",
      "sourceRef": "example",
      "subject": "example"
    }
  },
  "output": {
    "erased": 1
  }
}
```
