# identity.reset_complete

The person sets a new password from the reset link and makes fresh keys

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
| Team Space only | yes |
| HTTP | POST /v1/identity/reset_complete |
| MCP tool | none |
| CLI | none |
| Emits | password.reset, keys.stored, signin.succeeded |

## Input

```ts
type In = {
  resetCode: string;
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
  deviceName: string;
  deviceClass: "desktop" | "phone" | "web" | "extension" | "daemon";
};
```

## Output

```ts
type Out = {
  status: "ok" | "second_factor_required";
  challengeId?: string;
  session?: {
    sessionId: string;
    deviceId: string;
    token: string;
    expiresAt: number;
    epoch: number;
  };
  keys?: {
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

## Errors

- auth.expired
- auth.invalid_code
- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "deviceClass": "desktop",
    "deviceName": "example",
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
    "newPassword": "example",
    "resetCode": "example"
  },
  "output": {
    "challengeId": "chl_a1b2c3",
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
    "session": {
      "deviceId": "dev_a1b2c3",
      "epoch": 1,
      "expiresAt": 1760000000000,
      "sessionId": "ses_a1b2c3",
      "token": "example"
    },
    "status": "ok"
  }
}
```
