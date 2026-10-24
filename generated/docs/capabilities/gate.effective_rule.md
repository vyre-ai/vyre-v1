# gate.effective_rule

The effective rule for a principal and act: the strictest of Space policy, owner floor and agent.toml

| | |
|---|---|
| Module | gate |
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
| HTTP | POST /v1/gate/effective_rule |
| MCP tool | gate_effective_rule (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  principal: {
    kind: "person" | "agent" | "actor" | "service";
    id: string;
  };
  act: "send" | "post" | "pay" | "delete" | "push_protected" | "campaign_launch" | "secret_export" | "site_promote" | "signature_send" | "spend_raise";
};
```

## Output

```ts
type Out = {
  hold: boolean;
  reason: string;
  approvers: string;
  peopleOnly: boolean;
  afterHours: number;
  onTimeout: "drop" | "escalate";
  sources: {
    space: "hold" | "allow";
    floor?: "hold" | "allow";
    agent?: "hold" | "allow";
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
    "act": "send",
    "principal": {
      "id": "usr_a1b2c3",
      "kind": "person"
    }
  },
  "output": {
    "afterHours": 1,
    "approvers": "role:admin",
    "hold": true,
    "onTimeout": "drop",
    "peopleOnly": true,
    "reason": "example",
    "sources": {
      "agent": "hold",
      "floor": "hold",
      "space": "hold"
    }
  }
}
```
