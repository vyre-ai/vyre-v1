# gate.rules.list

List Gate rules: Space defaults, the owner floor and per-agent overrides

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
| HTTP | POST /v1/gate/rules/list |
| MCP tool | gate_rules_list (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  scope?: "space" | "floor" | "agent";
  agentId?: string;
};
```

## Output

```ts
type Out = {
  rules: Array<{
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
    }>;
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
    "scope": "space"
  },
  "output": {
    "rules": [
      {
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
    ]
  }
}
```
