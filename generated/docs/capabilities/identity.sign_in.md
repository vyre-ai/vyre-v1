# identity.sign_in

Sign in with Space, username and password; asks for the second factor when one is set

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
| HTTP | POST /v1/identity/sign_in |
| MCP tool | none |
| CLI | none |
| Emits | signin.succeeded, signin.failed |

## Input

```ts
type In = {
  username: string;
  password: string;
  deviceName: string;
  deviceClass: "desktop" | "phone" | "web" | "extension" | "daemon";
  totp?: string;
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

- auth.bad_credentials
- auth.invalid_code
- auth.second_factor_required
- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "deviceClass": "desktop",
    "deviceName": "example",
    "password": "example",
    "totp": "123456",
    "username": "example"
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
