# providers.space_key.remove

Remove the Space AI key; people with their own accounts keep working

| | |
|---|---|
| Module | vault |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | policy.manage |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | delete when actor.kind != 'person' |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/providers/space_key/remove |
| MCP tool | none |
| CLI | none |
| Emits | provider.removed, vault.item_deleted |

## Input

```ts
type In = Record<string, unknown>;
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
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {},
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
