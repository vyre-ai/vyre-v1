# identity.recovery_fetch

Fetch recovery-only encrypted keys and a short-lived sealed private-key possession challenge

| | |
|---|---|
| Module | identity |
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
| HTTP | POST /v1/identity/recovery_fetch |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  username: string;
};
```

## Output

```ts
type Out = {
  keys: {
    personKeyByRecovery: string;
    publicKey: string;
    privateKeyWrapped: string;
    spaceKeys: Array<{
        epoch: number;
        wrapped: string;
      }>;
  };
  challenge: {
    eph: string;
    iv: string;
    ct: string;
    tag: string;
  };
  context: string;
  expiresAt: number;
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
    "username": "example"
  },
  "output": {
    "challenge": {
      "ct": "example",
      "eph": "example",
      "iv": "example",
      "tag": "example"
    },
    "context": "example",
    "expiresAt": 1760000000000,
    "keys": {
      "personKeyByRecovery": "d3JhcHBlZA==",
      "privateKeyWrapped": "d3JhcHBlZA==",
      "publicKey": "example",
      "spaceKeys": [
        {
          "epoch": 1,
          "wrapped": "d3JhcHBlZA=="
        }
      ]
    }
  }
}
```
