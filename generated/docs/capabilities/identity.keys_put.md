# identity.keys_put

Store or replace the wrapped key bundle (first device, password change, recovery, new Space key epoch)

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
| HTTP | POST /v1/identity/keys_put |
| MCP tool | none |
| CLI | none |
| Emits | keys.stored |

## Input

```ts
type In = {
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
  reason: "first_device" | "password_change" | "reset" | "recovery" | "space_key_epoch" | "new_device";
};
```

## Output

```ts
type Out = {
  ok: boolean;
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
    "reason": "first_device"
  },
  "output": {
    "ok": true
  }
}
```
