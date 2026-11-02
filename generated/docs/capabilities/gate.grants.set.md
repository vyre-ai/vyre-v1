# gate.grants.set

Replace what an automation may send without a hold, for its definition as saved now. A person pressing Save or Turn on writes rows for the outward steps it names; anyone else leaves the automation with none

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
| HTTP | POST /v1/gate/grants/set |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  automationId: string;
  defHash: string;
  press: "save" | "on";
  steps: Array<{
      stepId: string;
      act: "send" | "post" | "pay" | "delete" | "transfer" | "enroll_node" | "connection_change" | "push_protected" | "campaign_launch" | "secret_export" | "site_promote" | "signature_send" | "spend_raise" | "signin_change" | "approve";
      targets: Array<string>;
      computed: boolean;
      changed: boolean;
    }>;
};
```

## Output

```ts
type Out = {
  grants: Array<{
      id: string;
      act: "send" | "post" | "pay" | "delete" | "transfer" | "enroll_node" | "connection_change" | "push_protected" | "campaign_launch" | "secret_export" | "site_promote" | "signature_send" | "spend_raise" | "signin_change" | "approve";
      target: string;
      stepId?: string;
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
    "automationId": "aut_a1b2c3",
    "defHash": "example",
    "press": "save",
    "steps": [
      {
        "act": "send",
        "changed": true,
        "computed": true,
        "stepId": "example",
        "targets": [
          "example"
        ]
      }
    ]
  },
  "output": {
    "grants": [
      {
        "act": "send",
        "id": "example",
        "stepId": "example",
        "target": "example"
      }
    ]
  }
}
```
