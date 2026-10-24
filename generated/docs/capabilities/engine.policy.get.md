# engine.policy.get

AI policies: allowed accounts, allowed models and providers, and which providers each label may reach

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/engine/policy/get |
| MCP tool | engine_policy_get (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  allowedAccounts: "any" | "company";
  allowedModels: Array<string>;
  allowedProviders: Array<string>;
  labelProviders: Record<string, Array<string>>;
  hops: {
    agentHops: number;
    reviewLoops: number;
    ciFixLoops: number;
  };
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
  "input": {},
  "output": {
    "allowedAccounts": "any",
    "allowedModels": [
      "example"
    ],
    "allowedProviders": [
      "example"
    ],
    "hops": {
      "agentHops": 1,
      "ciFixLoops": 1,
      "reviewLoops": 1
    },
    "labelProviders": {}
  }
}
```
