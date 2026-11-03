# gate.grants.goal

System: what a goal may do without a hold. The owner's press on the goal names the acts (set); the goal's own chats are where they hold, and only while it runs (threads, empty to end them). Only the goals module calls it

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
| HTTP | POST /v1/gate/grants/goal |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  goalId: string;
  person: string;
  threads: Array<string>;
  until: number;
  set?: Array<{
      act: "send" | "post" | "pay" | "delete" | "transfer" | "enroll_node" | "connection_change" | "push_protected" | "secret_export" | "site_promote" | "signature_send" | "spend_raise" | "signin_change" | "approve";
      target: string;
    }>;
};
```

## Output

```ts
type Out = {
  acts: number;
  rows: number;
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
    "goalId": "gol_a1b2c3",
    "person": "usr_a1b2c3",
    "set": [
      {
        "act": "send",
        "target": "example"
      }
    ],
    "threads": [
      "thr_a1b2c3"
    ],
    "until": 1760000000000
  },
  "output": {
    "acts": 1,
    "rows": 1
  }
}
```
