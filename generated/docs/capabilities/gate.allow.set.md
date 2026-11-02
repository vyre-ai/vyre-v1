# gate.allow.set

Always allow: a rule the Gate reads, for one agent or one chat, one act and one target, with an expiry. Local changes are a person's to allow; an outward act needs an admin; money is never allowed this way

| | |
|---|---|
| Module | gate |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/gate/allow/set |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  act: "send" | "post" | "pay" | "delete" | "transfer" | "enroll_node" | "connection_change" | "push_protected" | "campaign_launch" | "secret_export" | "site_promote" | "signature_send" | "spend_raise" | "signin_change" | "approve";
  target: string;
  agentId?: string;
  threadId?: string;
  days?: number;
};
```

## Output

```ts
type Out = {
  rule: {
    id: string;
    kind: "standing" | "always";
    act: "send" | "post" | "pay" | "delete" | "transfer" | "enroll_node" | "connection_change" | "push_protected" | "campaign_launch" | "secret_export" | "site_promote" | "signature_send" | "spend_raise" | "signin_change" | "approve";
    target: string;
    agentId?: string;
    threadId?: string;
    automationId?: string;
    stepId?: string;
    expiresAt?: number;
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "act": "send",
    "agentId": "agt_a1b2c3",
    "days": 1,
    "target": "example",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "rule": {
      "act": "send",
      "agentId": "agt_a1b2c3",
      "automationId": "aut_a1b2c3",
      "expiresAt": 1760000000000,
      "id": "example",
      "kind": "standing",
      "stepId": "example",
      "target": "example",
      "threadId": "thr_a1b2c3"
    }
  }
}
```
