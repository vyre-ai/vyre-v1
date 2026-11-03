# identity.link_account

Use one account everywhere: this Space's sign-in takes the username, password and key wraps of the account you keep. Your data, role and membership here stay

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
| HTTP | POST /v1/identity/link_account |
| MCP tool | none |
| CLI | none |
| Emits | account.linked, password.changed, keys.stored, signin.succeeded, signin.failed |

## Input

```ts
type In = {
  currentPassword?: string;
  recoveryProof?: string;
  username: string;
  password: string;
  keys: {
    personKeyByPassword: string;
    personKeyByRecovery?: string;
    publicKey: string;
    privateKeyWrapped: string;
    spaceKeys: Array<{
        epoch: number;
        wrapped: string;
      }>;
    formerKey?: string;
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
    formerKey?: string;
  };
};
```

## Errors

- auth.bad_credentials
- auth.invalid_code
- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.duplicate

## Example

```json
{
  "name": "example",
  "input": {
    "currentPassword": "example",
    "deviceClass": "desktop",
    "deviceName": "example",
    "keys": {
      "formerKey": "d3JhcHBlZA==",
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
    "password": "example",
    "recoveryProof": "example",
    "username": "maya"
  },
  "output": {
    "challengeId": "chl_a1b2c3",
    "keys": {
      "formerKey": "d3JhcHBlZA==",
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
