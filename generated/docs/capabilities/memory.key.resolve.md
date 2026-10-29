# memory.key.resolve

The account that pays for one scope's upkeep and where the choice came from (agent, project, Space or person); no key means rule-based upkeep

| | |
|---|---|
| Module | memory |
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
| HTTP | POST /v1/memory/key/resolve |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  layer: "person" | "agent" | "project" | "space";
  ownerRef: string;
  agentId?: string;
  projectId?: string;
};
```

## Output

```ts
type Out = {
  reason?: "no_key" | "key_unavailable";
  key?: {
    accountRef: string;
    provider?: string;
    kind?: string;
    source: "agent" | "project" | "space" | "person";
    model?: string;
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
    "layer": "person",
    "ownerRef": "example",
    "projectId": "prj_a1b2c3"
  },
  "output": {
    "key": {
      "accountRef": "example",
      "kind": "example",
      "model": "example",
      "provider": "example",
      "source": "agent"
    },
    "reason": "no_key"
  }
}
```
