# gate.grants.take

System: does a grant cover this call? Asked by the Gate hook at act time, it spends a single-use grant; only the server may call it

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
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/gate/grants/take |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  act: "send" | "post" | "pay" | "delete" | "transfer" | "enroll_node" | "connection_change" | "push_protected" | "campaign_launch" | "secret_export" | "site_promote" | "signature_send" | "spend_raise" | "signin_change" | "approve";
  targets: Array<string>;
  step?: {
    automationId: string;
    nodeId: string;
    defHash: string;
    ask?: boolean;
  };
  turn?: {
    person: string;
    threads: Array<string>;
  };
};
```

## Output

```ts
type Out = {
  granted: boolean;
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
    "step": {
      "ask": true,
      "automationId": "aut_a1b2c3",
      "defHash": "example",
      "nodeId": "example"
    },
    "targets": [
      "example"
    ],
    "turn": {
      "person": "example",
      "threads": [
        "thr_a1b2c3"
      ]
    }
  },
  "output": {
    "granted": true
  }
}
```
