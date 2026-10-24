# members.accept

Accept an invite: pick a username and password, the device makes its keys; the person becomes active

| | |
|---|---|
| Module | members |
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
| HTTP | POST /v1/members/accept |
| MCP tool | none |
| CLI | none |
| Emits | member.joined, principal.created |

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
  personId: string;
  sessionId: string;
  token: string;
  epoch: number;
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
    "epoch": 1,
    "personId": "usr_a1b2c3",
    "sessionId": "ses_a1b2c3",
    "token": "example"
  }
}
```
