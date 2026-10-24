# gate.rules.set

Set a Gate rule for an act at the Space, owner floor or agent level; a rule can never loosen the strictest level

| | |
|---|---|
| Module | gate |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | policy.manage |
| Grant level | manage |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/gate/rules/set |
| MCP tool | gate_rules_set (engineer) |
| CLI | none |
| Emits | gate.rule_changed |

## Input

```ts
type In = {
  act: "send" | "post" | "pay" | "delete" | "push_protected" | "campaign_launch" | "secret_export" | "site_promote" | "signature_send" | "spend_raise";
  scope: "space" | "floor" | "agent";
  agentId?: string;
  mode: "hold" | "allow";
  approvers?: string;
  agentOkFor?: "low" | "medium" | "high";
  afterHours?: number;
  onTimeout?: "drop" | "escalate";
  escalateTo?: "delegate" | "role";
};
```

## Output

```ts
type Out = {
  rule: {
    act: "send" | "post" | "pay" | "delete" | "push_protected" | "campaign_launch" | "secret_export" | "site_promote" | "signature_send" | "spend_raise";
    mode: "hold" | "allow";
    approvers: string;
    peopleOnly: boolean;
    agentOkFor?: "low" | "medium" | "high";
    afterHours: number;
    onTimeout: "drop" | "escalate";
    escalateTo: "delegate" | "role";
    emailBackstopHours: number;
    scope: "space" | "floor" | "agent";
    agentId?: string;
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "act": "send",
    "afterHours": 1,
    "agentId": "agt_a1b2c3",
    "agentOkFor": "low",
    "approvers": "role:admin",
    "escalateTo": "delegate",
    "mode": "hold",
    "onTimeout": "drop",
    "scope": "space"
  },
  "output": {
    "rule": {
      "act": "send",
      "afterHours": 1,
      "agentId": "agt_a1b2c3",
      "agentOkFor": "low",
      "approvers": "role:admin",
      "emailBackstopHours": 1,
      "escalateTo": "delegate",
      "mode": "hold",
      "onTimeout": "drop",
      "peopleOnly": true,
      "scope": "space"
    }
  }
}
```
