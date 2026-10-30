# automations.try_read

Try one read. Name a stored connector action (app and action) and the host sends it with the Vault key. Or name a documented host (method, path, domains, vaultItemId). The reply is the level, plus the shape of the reply for a stored action.

| | |
|---|---|
| Module | automations |
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
| HTTP | POST /v1/automations/try_read |
| MCP tool | automations_try_read (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  app?: string;
  action?: string;
  input?: Record<string, unknown>;
  allowHost?: string;
  method?: string;
  path?: string;
  domains?: Array<string>;
  markedSafe?: boolean;
  vaultItemId?: string;
  actionKey?: string;
};
```

## Output

```ts
type Out = {
  level: "tested" | "draft";
  reason?: string;
  status?: number;
  shape?: unknown;
  notes?: Array<string>;
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
    "action": "list_customers",
    "actionKey": "example",
    "allowHost": "example",
    "app": "stripe",
    "domains": [
      "example"
    ],
    "input": {},
    "markedSafe": true,
    "method": "example",
    "path": "example",
    "vaultItemId": "example"
  },
  "output": {
    "level": "tested",
    "notes": [
      "example"
    ],
    "reason": "example",
    "shape": {},
    "status": 1
  }
}
```
