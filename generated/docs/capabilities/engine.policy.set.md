# engine.policy.set

Change AI policies (models and providers, per label provider rules, allowed accounts)

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | ai.models |
| Grant level | manage |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/engine/policy/set |
| MCP tool | engine_policy_set (meta) |
| CLI | none |
| Emits | engine.policy_changed |

## Input

```ts
type In = {
  allowedAccounts?: "any" | "company";
  allowedModels?: Array<string>;
  allowedProviders?: Array<string>;
  labelProviders?: Record<string, Array<string>>;
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
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "allowedAccounts": "any",
    "allowedModels": [
      "example"
    ],
    "allowedProviders": [
      "example"
    ],
    "labelProviders": {}
  },
  "output": {
    "ok": true
  }
}
```
