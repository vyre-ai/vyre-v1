# identity.change_password

Change my own password; keys are re-wrapped on the device first

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
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/identity/change_password |
| MCP tool | none |
| CLI | none |
| Emits | password.changed, keys.stored |

## Input

```ts
type In = {
  currentPassword: string;
  newPassword: string;
  keys: {
    personKeyByPassword: string;
    personKeyByRecovery?: string;
    publicKey: string;
    privateKeyWrapped: string;
    spaceKeys: Array<{
        epoch: number;
        wrapped: string;
      }>;
  };
};
```

## Output

```ts
type Out = {
  ok: boolean;
};
```

## Errors

- auth.bad_credentials
- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "currentPassword": "example",
    "keys": {
      "personKeyByPassword": "d3JhcHBlZA==",
      "personKeyByRecovery": "d3JhcHBlZA==",
      "privateKeyWrapped": "d3JhcHBlZA==",
      "publicKey": "cHVibGlj",
      "spaceKeys": [
        {
          "epoch": 1,
          "wrapped": "d3JhcHBlZA=="
        }
      ]
    },
    "newPassword": "example"
  },
  "output": {
    "ok": true
  }
}
```
