# providers.space_key.get

The Space AI key for the Space: whether one is set, its provider and the models it unlocks (read live from the provider and kept for a while). Never the key

| | |
|---|---|
| Module | vault |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | member |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/providers/space_key/get |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  refresh?: boolean;
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
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "refresh": true
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
