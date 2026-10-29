# network.enroll_status

A waiting computer asks whether it was approved by signing a fresh timestamp with its key; approved, it receives its credential once (called by the computer, no sign-in)

| | |
|---|---|
| Module | network |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/network/enroll_status |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  serverId: string;
  at: number;
  signature: string;
};
```

## Output

```ts
type Out = {
  state: "pending" | "approved" | "declined" | "revoked";
  fingerprint: string;
  credential?: string;
};
```

## Errors

- auth.invalid_code
- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "at": 1,
    "serverId": "srv_a1b2c3",
    "signature": "example"
  },
  "output": {
    "credential": "example",
    "fingerprint": "example",
    "state": "pending"
  }
}
```
