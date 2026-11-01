# gate.allow.list

What may go without asking: your Always allow rules and the automations your press gave permission to

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
| HTTP | POST /v1/gate/allow/list |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  rules: Array<{
      id: string;
      kind: "standing" | "always";
      act: "send" | "post" | "pay" | "delete" | "transfer" | "enroll_node" | "connection_change" | "push_protected" | "campaign_launch" | "secret_export" | "site_promote" | "signature_send" | "spend_raise" | "signin_change" | "approve";
      target: string;
      agentId?: string;
      threadId?: string;
      automationId?: string;
      stepId?: string;
      expiresAt?: number;
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
  "input": {},
  "output": {
    "rules": [
      {
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
    ]
  }
}
```
