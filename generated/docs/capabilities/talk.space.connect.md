# talk.space.connect

An admin adds or replaces the key that covers everyone: it is checked at once, then kept in a Restricted Shared folder. A person does this, never an agent

| | |
|---|---|
| Module | talk |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | policy.manage |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/talk/space/connect |
| MCP tool | none |
| CLI | none |
| Emits | talk.connected, talk.space_changed |

## Input

```ts
type In = {
  provider: string;
  fields: Array<{
      key: string;
      value: string;
      secret?: boolean;
    }>;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  set: boolean;
  on: boolean;
  provider?: string;
  itemId?: string;
  setBy?: string;
  checkedAt?: number;
  state?: "ok" | "failing";
  peopleOwnKey?: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- provider.auth_failed
- provider.network
- provider.rate_limited
- provider.unavailable
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "fields": [
      {
        "key": "api_key",
        "secret": true,
        "value": "example"
      }
    ],
    "idempotencyKey": "idem_1",
    "provider": "deepgram"
  },
  "output": {
    "checkedAt": 1760000000000,
    "itemId": "vit_a1b2c3",
    "on": true,
    "peopleOwnKey": 1,
    "provider": "deepgram",
    "set": true,
    "setBy": "usr_a1b2c3",
    "state": "ok"
  }
}
```
