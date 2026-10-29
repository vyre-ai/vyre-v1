# network.enroll

A computer asks to join the Space with a join code and its own public key; it waits for approval (called by the computer, no sign-in)

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
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/network/enroll |
| MCP tool | none |
| CLI | none |
| Emits | network.server_requested |

## Input

```ts
type In = {
  code: string;
  publicKey: string;
  name: string;
  facts?: {
    os?: string;
    arch?: string;
    docker?: boolean;
    version?: string;
  };
};
```

## Output

```ts
type Out = {
  serverId: string;
  fingerprint: string;
  state: "pending";
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
    "code": "example",
    "facts": {
      "arch": "example",
      "docker": true,
      "os": "example",
      "version": "example"
    },
    "name": "example",
    "publicKey": "example"
  },
  "output": {
    "fingerprint": "K7QD-4M2X",
    "serverId": "srv_a1b2c3",
    "state": "pending"
  }
}
```
