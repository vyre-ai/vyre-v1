# providers.space_key.set

An owner or admin sets or replaces the Space AI key: it is checked with the provider at once (its model list), then kept in a Restricted Shared folder. A person does this, or their outside agent under the setup grant; never an agent on its own

| | |
|---|---|
| Module | vault |
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
| HTTP | POST /v1/providers/space_key/set |
| MCP tool | providers_space_key_set (vault) |
| CLI | none |
| Emits | provider.added, provider.removed, vault.item_created, vault.item_deleted, vault.folder_created |

## Input

```ts
type In = {
  providerKey: string;
  apiKey: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  set: boolean;
  providerKey?: string;
  name?: string;
  providerId?: string;
  models: Array<string>;
  state?: "ok" | "failing";
  setBy?: string;
  setAt?: number;
  checkedAt?: number;
  mayManage: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- provider.auth_failed
- provider.unavailable
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "apiKey": "example",
    "idempotencyKey": "idem_1",
    "providerKey": "opencode-go"
  },
  "output": {
    "checkedAt": 1760000000000,
    "mayManage": true,
    "models": [
      "glm-5.3"
    ],
    "name": "OpenCode Go",
    "providerId": "prv_a1b2c3",
    "providerKey": "opencode-go",
    "set": true,
    "setAt": 1760000000000,
    "setBy": "usr_a1b2c3",
    "state": "ok"
  }
}
```
