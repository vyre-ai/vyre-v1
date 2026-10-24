# invites.accept_create_account

Join by invite with no account yet: creates the person, sets the password, stores the wrapped keys and joins the Space with the invite's role and groups

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
| HTTP | POST /v1/invites/accept_create_account |
| MCP tool | none |
| CLI | none |
| Emits | member.joined, principal.created, keys.stored, signin.succeeded |

## Input

```ts
type In = {
  code: string;
  username: string;
  displayName?: string;
  password: string;
  deviceName: string;
  deviceClass: "desktop" | "phone" | "web" | "extension" | "daemon";
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
- permission.no_grant
- validation.bad_input
- validation.duplicate

## Example

```json
{
  "name": "example",
  "input": {
    "code": "example",
    "deviceClass": "desktop",
    "deviceName": "example",
    "displayName": "example",
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
    "password": "example",
    "username": "maya"
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
